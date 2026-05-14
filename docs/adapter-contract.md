# Adapter Contract

An adapter exports `name`, `provider`, `capabilities`, optional `raw`, and one or more domain adapter objects. Each adapter should implement only the domains it owns.

```ts
import type { CapsuleAdapter, CapabilityMap } from "@capsule/core";

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
2. Create `packages/adapter-provider-name`, or run `capsule adapter scaffold <provider> --domain <domain>`.
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
- `raw`: optional escape hatch for provider-specific clients, base URLs, or metadata. It must not replace the common domain API.

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

## Minimal Contract Test Template

Use the core contract helpers first. They verify that declared public capabilities match implemented public methods and that unsupported capabilities throw `UnsupportedCapabilityError`.

```ts
import { describe, expect, test } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { exampleAdapter } from "./example-adapter.js";

describe("example adapter", () => {
  test("satisfies the public adapter contract", async () => {
    await runAdapterContract(exampleAdapter({ fakeClient: true }));
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

For live tests:

```ts
import { describe, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveTest, providerLiveTestGate } from "@capsule/test-utils";
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
