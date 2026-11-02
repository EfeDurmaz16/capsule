# Adapter Contract

An adapter exports `name`, `provider`, `capabilities`, optional `raw`, and one or more domain adapter objects. Each adapter should implement only the domains it owns.

```ts
import type { CapsuleAdapter, CapabilityMap } from "@capsule-sdk/core";

export const exampleCapabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "emulated",
    fileWrite: "emulated",
    fileList: "unsupported",
    destroy: "native"
  },
  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported"
  }
};

export function exampleAdapter(): CapsuleAdapter {
  return {
    name: "example",
    provider: "example-cloud",
    capabilities: exampleCapabilities,
    raw: { docs: "https://provider.example/docs" },
    sandbox: {
      create: async (spec, context) => {
        context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        throw new Error("implement provider call here");
      }
    }
  };
}
```

## Support Levels

Every adapter must declare support levels honestly:

- `native`: the provider exposes the capability directly and the adapter uses that API. Example: Cloud Run Jobs for `job.run`.
- `emulated`: Capsule or the adapter approximates the capability outside the provider's native model. Example: file artifacts collected by copying files after a run.
- `experimental`: the capability exists but semantics, coverage, or provider behavior are still being validated. Example: a provider beta API or partial resource control.
- `unsupported`: the adapter does not implement the capability. Public Capsule calls must throw `UnsupportedCapabilityError`.

Never silently emulate without marking the feature as `emulated`. Never mark something `native` only because it can be scripted through a side channel.

## Implementation Steps

For a longer onboarding walkthrough, see [Adding a provider adapter](adding-provider-adapter.md).

1. Classify the provider service with `capsule classify provider <provider> <service>`.
2. Create `packages/provider-name`, or run `capsule adapter scaffold <provider> --domain <domain>`.
3. Add `package.json`, `tsconfig.json`, `src/index.ts`, and a provider adapter file if you are not using the scaffold.
4. Export a factory function such as `providerName(options)`.
5. Define the smallest truthful `CapabilityMap`.
6. Implement one domain first: sandbox, job, service, edge, database, preview, or machine.
7. Call `context.evaluatePolicy(...)` before executing provider actions that accept env, secrets, timeouts, resources, TTL, or cost-sensitive inputs.
8. Attach receipts through `context.createReceipt(...)` when `context.receipts` is enabled.
9. Redact provider tokens and user secrets from errors, logs, stdout/stderr, receipt metadata, and test snapshots.
10. Add fake-client tests for request mapping and receipt shape.
11. Add optional live tests only behind `CAPSULE_LIVE_TESTS=1` and provider credentials.

## Required Adapter Fields

- `name`: stable adapter name, usually the package/provider short name.
- `provider`: provider family, such as `docker`, `e2b`, `cloud-run`, or `neon`.
- `capabilities`: complete map for implemented domains and explicit unsupported entries for public capabilities in that domain.
- `raw`: optional escape hatch for provider-specific clients, base URLs, or metadata. It must not replace the common domain API. Anything invoked through `raw()` is outside Capsule's governed facade: no capability check, policy evaluation, receipt creation, redaction, or required receipt durability is applied by core.

## Receipts

Receipts should include:

- `type`
- `capabilityPath`
- `supportLevel`
- provider resource ID/name/status/url when available
- policy decision and notes
- command/image/source/cwd metadata when relevant
- stdout/stderr hashes for execution results

Receipt notes should be candid. Say when enforcement is delegated, emulated, best-effort, unsupported, or provider-specific.

## Provider Error Classification

Provider API clients should keep throwing `AdapterExecutionError`, but HTTP or SDK failures with stable status/code metadata should attach `cause.providerError` from `classifyProviderError(...)`. Use the common categories `auth`, `validation`, `rate-limit`, `retryable`, and `unknown`; do not invent adapter-specific retry labels.

HTTP-client adapters (azure-container-apps, cloud-run, cloudflare, fly, neon, vercel) classify directly from the `Response` status:

```ts
throw new AdapterExecutionError(message, {
  status: response.status,
  error: data,
  providerError: classifyProviderError({ status: response.status, headers: response.headers, error: data })
});
```

SDK-based and CLI-based adapters (docker, kubernetes, lambda, ec2, ecs, e2b, daytona, modal, mock) normalize provider error shapes through the same taxonomy before wrapping. Use `asProviderError(error, fallbackMessage)` (or `callProvider(fallbackMessage, () => sdkCall())`) to map SDK error objects (status codes, error names/codes) into a typed `ProviderAuthError`/`ProviderValidationError`/`ProviderRateLimitError`/`ProviderRetryableError`, or `classifySdkError(error)` when you need the raw classification. Docker classifies conservatively from CLI exit codes and stderr with `classifyDockerCliError(...)`: unreachable daemon or timeout is `retryable`, missing image/container is `validation`, and permission or registry-auth failures are `auth`.

Every adapter now surfaces the same typed categories, so all fifteen adapters classify provider failures rather than only the six HTTP clients.

Do not classify workload failures as provider failures. For example, a sandbox command exit code or Lambda `FunctionError` is execution state, not a provider transport/control-plane error.

## Pending, Unknown and Partial Outcomes

Never report a terminal state the provider has not confirmed. A deleted, stopped or completed result requires an observed terminal state, not an accepted request (for example HTTP 202, an operation with `done: false`, or a scale-down acknowledgement while tasks still run).

- Where a public result type already has transitional values (for example `MachineLifecycleResult`, `DestroyPreviewResult`, Neon `creating`/`resetting`), return the truthful transitional status.
- Where the public promise is terminal-only (for example `DeletedService`), observe the accepted action with `observeUntilTerminal(observe, { operation, resource, deadlineMs })`. When the bounded deadline expires it throws `PendingOperationError` with the safe locator and last native state. The deadline is a client budget and is separate from any provider-side wait parameter.
- When Capsule cannot tell whether the provider applied an action (for example the transport failed after the request was sent), throw `UnknownOutcomeError`. Do not retry a create or mutate automatically.
- Build locators with `resourceLocator({ provider, kind, nativeId, scope })`. It strips URL credentials, query strings and control characters so the locator is safe in errors and receipts.
- When an operation leaves resources behind, attach a `PartialEffects` record: primary outcome, locators, primary error or completed result, and the cleanup outcome. Throw `CleanupFailureError(message, cleanup, cause, effects)` when cleanup failed, otherwise `PartialEffectsError`. Callers read either with `partialEffectsOf(error)`.

`Machine["status"]` is `MachineStatus`: `creating`, `starting`, `running`, `stopping`, `stopped`, `destroying`, `failed` or `deleted`. Map provider transitions to the matching transitional value and keep the native state in metadata. Do not map an unrecognized native state to `failed`.

## Capture Bounds

Log and output specs accept `bounds?: CaptureBounds` (`maxBytes`, `maxRecords`, `deadlineMs`, `concurrency`, `overflow`). Resolve them with `resolveCaptureBounds(...)` (or `resolveExecOutputBounds(spec.bounds, policy)` for exec output, which applies `policy.limits.maxStdoutBytes`/`maxStderrBytes` as ceilings) and enforce them while consuming with `CaptureBudget`, not by slicing after buffering. Report what was kept on `truncation` (`ExecResult.truncation.stdout`/`stderr`, or the logs result `truncation`). `readBoundedText(response, maxBytes)` reads a bounded HTTP body and cancels the rest; `mapWithConcurrency(items, limit, fn)` caps provider requests in flight. Defaults are in `defaultCaptureBounds`. If a provider SDK buffers the full response before Capsule sees it, say so: Capsule bounds only what it consumes.

## Fresh Per-Operation Approval

`ExecSpec.approval` and `sandbox.destroy({ approval })` carry a fresh grant for that one operation. It replaces the grant captured at `sandbox.create` for that call and is validated for the operation's own capability and resource. The captured create grant stays as a compatibility fallback and is validated the same way, so a grant scoped to `sandbox.create` never authorizes exec or destroy. Core does not forward the approval to adapters. Cleanup code that needs approval asks a `CleanupApprovalResolver` for a grant scoped to the cleanup action; it never copies a create grant into a delete.

## Minimal Contract Test Template

Use the core contract helpers first. They are guard-only checks: they run no successful lifecycle, so passing them is not lifecycle evidence. They verify that declared public capabilities match implemented public methods, unsupported capabilities throw `UnsupportedCapabilityError`, and supported mutating capabilities fail closed under an approval-required policy before adapter code runs.

```ts
import { describe, expect, test } from "vitest";
import { Capsule, runCapsuleAdapterContract } from "@capsule-sdk/core";
import { exampleAdapter } from "./example-adapter.js";

describe("example adapter", () => {
  test("passes the guard-only adapter contract checks", async () => {
    await runCapsuleAdapterContract(exampleAdapter({ fakeClient: true }), {
      domains: ["sandbox", "job"]
    });
  });

  test("declares support levels honestly", () => {
    const capsule = new Capsule({ adapter: exampleAdapter({ fakeClient: true }) });

    expect(capsule.supportLevel("sandbox.create")).toBe("native");
    expect(capsule.supportLevel("sandbox.fileRead")).toBe("emulated");
    expect(capsule.supports("job.run")).toBe(false);
  });

  test("attaches receipts and policy notes", async () => {
    const capsule = new Capsule({
      adapter: exampleAdapter({ fakeClient: true }),
      receipts: true,
      policy: { network: { mode: "none" }, limits: { timeoutMs: 1_000 } }
    });

    const sandbox = await capsule.sandbox.create({ name: "contract-test" });
    const result = await sandbox.exec({ command: ["echo", "hello"] });

    expect(result.receipt).toMatchObject({
      provider: "example-cloud",
      adapter: "example",
      capabilityPath: "sandbox.exec",
      supportLevel: "native",
      policy: { decision: "allowed" }
    });
    expect(result.receipt?.policy.notes?.join(" ")).toContain("network");
  });
});
```

Adapter-specific partial-failure behavior can be added with `failureScenarios`. Use this for cleanup metadata, provider rollback behavior, and receipt-binding regressions that only a given fake client can trigger:

```ts
await runCapsuleAdapterContract(exampleAdapter({ fakeClient: true }), {
  capabilities: ["service.deploy"],
  failureScenarios: [
    {
      name: "cleans up service after route failure",
      exercise: (capsule) => capsule.service.deploy({ name: "partial", image: "node:22" }),
      expectError: (error) => {
        expect(error).toMatchObject({ cleanup: { status: "deleted" } });
      }
    }
  ]
});
```

For live tests:

```ts
import { describe, test } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { liveTest, providerLiveTestGate } from "@capsule-sdk/test-utils";
import { exampleAdapter } from "./example-adapter.js";

describe("example adapter live", () => {
  const gate = providerLiveTestGate("example" as never, {
    credentials: ["EXAMPLE_API_TOKEN"]
  });

  liveTest(test, "creates and destroys a sandbox", gate, async () => {
    const capsule = new Capsule({ adapter: exampleAdapter(), receipts: true });
    const sandbox = await capsule.sandbox.create({ name: "capsule-live-test" });
    await sandbox.destroy();
  });
});
```

Live tests must never run by default in CI. They require `CAPSULE_LIVE_TESTS=1` plus credentials.

## Provider-Maintained Adapters

Provider teams can maintain official adapters by owning:

- the capability map
- adapter docs and caveats
- fake-client tests
- optional live tests
- receipt and policy notes
- release notes for capability changes

Capability changes are API changes. Moving from `unsupported` to `experimental`, `experimental` to `native`, or `native` to `unsupported` should be documented in a changeset/release note.
