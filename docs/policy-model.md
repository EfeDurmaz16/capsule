# Policy Model

Capsule policies cover network, filesystem, secrets, limits, cost, TTL, and approvals.

Core can validate env and secret keys, merge timeout limits, enforce approval requirements, enforce requested TTL maxima for TTL-scoped create operations, redact configured secret values from stdout, stderr, and Capsule-observed log entries, and record policy decisions. Policy decisions include the operation capability path and adapter support level when Capsule can infer them, so an audit can replay the decision from the operation spec, default policy, approval grant, resource hint, and adapter capability map. Adapters enforce what the provider can enforce. Providers enforce runtime-specific controls.

Network policy can be `none`, `allowlist`, or `all`. Docker can apply `none` with `--network none`, which removes container network access through Docker's own network mode for that container. It is still local Docker, not a complete hostile-code sandbox. Docker allowlists are not natively enforced by the adapter, so allowlist requests are recorded as unsupported/best-effort notes.

Filesystem policy may be native in some sandbox providers and emulated in local adapters. Secrets policy denies env keys not listed in `policy.secrets.allowed` when that policy exists; a `secrets` block that omits `allowed` (or sets it to `[]`) denies every env key, and no `secrets` block means env keys are not checked. `policy.secrets.redactFromLogs` redacts configured env secret values from Capsule-observed output and errors. Credential-shaped values (`Bearer` tokens, `sk_live_`/`pk_live_` style keys, GitHub and Slack token prefixes, JWTs) are always redacted from Capsule-observed logs, receipt metadata, and provider options, on every profile. `policy.secrets.redactionProfile: "strict"` additionally redacts any long token-like string (48+ url-safe characters), which can also catch non-secret values such as hashes; `redactKeys` adds project-specific key names to the receipt redaction set.

Limit policy includes timeout, output size, memory, and CPU. Timeout is straightforward for local process management; memory and CPU depend on provider support.

Approval policies fail closed in core when `policy.approvals.required` is set and the operation spec does not include `approval: { approved: true, ... }`. Approval grants can carry an approval id, approver, reason, `approvedAt`, `expiresAt`, allowed `capabilities`, scoped `resources`, and small metadata for audit context. Expired grants, invalid expiry timestamps, capability mismatches, and resource-scope mismatches are denied before provider execution. Sandbox exec and destroy accept a fresh per-operation grant (`exec({ approval })`, `destroy({ approval })`) that replaces the grant captured at create for that call only; the captured grant remains a validated fallback, and a grant scoped to `sandbox.create` never authorizes exec or destroy. A captured grant that has expired since create is never reused: exec and destroy deny until the caller passes a fresh grant. Adapter-side policy checks during a sandbox operation see the same grant and capability path as the facade. Sandbox file operations (`writeFile`, `readFile`, `listFiles`) still use only the captured create grant, so once it expires they deny and there is no per-call override for them yet. Cleanup that needs a fresh grant uses the `CleanupApprovalResolver` contract: a resolver that returns `undefined` denies that cleanup, and the resource is reported as residual instead of being destroyed with the create grant. TTL policy fails closed in core when a request includes `ttlMs` above `policy.ttl.maxMs`; provider-side cleanup still depends on adapter/provider lifecycle support.

## Decision Shape

`evaluatePolicy` returns a typed `PolicyDecision`. Alongside `decision`, `applied`, and human-readable `notes`, it reports:

- `enforcement`: how the decision is enforced, one of `native`, `delegated`, `advisory`, or `unsupported`. It is derived conservatively from the adapter-declared support level for the capability: `native` support maps to `native`, `unsupported` maps to `unsupported`, and everything else defaults to `delegated`. Callers may pass an explicit `enforcement` (for example `advisory` for control-plane-only constraints) to override the derivation.
- `trace`: an ordered `Array<{ check, verdict }>` mirroring the checks `evaluatePolicy` ran, with `verdict` of `passed`, `noted`, or `denied`. Denied decisions surface a single denied entry.
- `cost`: present when the policy declares `cost.maxUsd`, as `{ requestedUsd?, limitUsd, withinLimit }`. Cost is advisory; Capsule does not enforce provider billing.
- `ttl`: present when the policy declares `ttl.maxMs`, as `{ requestedMs?, limitMs, withinLimit }`.
- `network`: present when the policy declares a network block, as `{ mode, support, hosts }` where `support` is the adapter's declared `networkPolicy` support level (or `unknown`) and `hosts` is a per-host `{ host, allowed }` diagnostic derived from the declared allowlist.

The `enforcement` mode, `trace`, `cost`, `ttl`, and `network` diagnostics travel with the decision into the receipt `policy` section, so an audit can replay both the verdict and how it was enforced.

## Merging Policies

`mergePolicy(base, override)` combines two policies and always fails toward the stricter side:

- `network.mode`: the stricter mode wins (`none` > `allowlist` > `all`); an undeclared side is treated as unrestricted.
- `network.allowedHosts`: intersected when both sides declare an allowlist; otherwise the declared list is kept.
- `secrets.allowed`: when both sides declare a `secrets` block, their effective allowlists are intersected. A `secrets` block that omits `allowed` already denies every env key, so it counts as an empty allowlist and the merged policy stays deny-all in either merge order. When only one side declares a `secrets` block, that block is kept unchanged.
- `secrets.redactFromLogs`: OR toward safety.
- `secrets.redactionProfile`: `strict` wins over `standard`.
- `secrets.redactKeys`: union.
- `filesystem.read` / `filesystem.write`: intersected when both declare a list; otherwise the declared list is kept.
- `limits.*`, `cost.maxUsd`, `ttl.maxMs`: the smaller (stricter) declared value wins.
- `approvals.required`: OR toward safety.

## Policy Explain

`explainPolicy(policy, input)` returns an allowed or denied decision without throwing and without executing an adapter action. Denied reports include the violation reason and violating fields; allowed reports include the same notes `evaluatePolicy` would record in receipts.

The CLI exposes the same dry-run path:

```bash
capsule policy explain --adapter docker --capability job.run --policy-file policy.json --spec-file job-spec.json
```

The policy file contains a `CapsulePolicy` JSON object. The spec file contains policy input such as `env`, `timeoutMs`, `ttlMs`, `approval`, or `resource`. The output includes the adapter support level for the requested capability and summarizes env keys instead of printing env values.

Cost policies are control-plane constraints. Adapters should record whether enforcement is native, delegated, emulated, or unsupported.

Cloud providers must not be described as OS-level enforcement unless the provider API actually supplies that guarantee. For Cloud Run, ECS/Fargate, Kubernetes, Lambda, Fly Machines, Azure Container Apps, Vercel, Cloudflare, Neon, and EC2, Capsule receipts describe what Capsule requested and observed, plus whether enforcement was delegated to the provider, emulated by the adapter, unsupported, or best-effort.
