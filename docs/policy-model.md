# Policy Model

Capsule policies cover network, filesystem, secrets, limits, cost, TTL, and approvals.

Core can validate env and secret keys, merge timeout limits, enforce approval requirements, enforce requested TTL maxima for TTL-scoped create operations, redact configured secret values from stdout, stderr, and Capsule-observed log entries, and record policy decisions. Policy decisions include the operation capability path and adapter support level when Capsule can infer them, so an audit can replay the decision from the operation spec, default policy, approval grant, resource hint, and adapter capability map. Adapters enforce what the provider can enforce. Providers enforce runtime-specific controls.

Network policy can be `none`, `allowlist`, or `all`. Docker can apply `none` with `--network none`, which removes container network access through Docker's own network mode for that container. It is still local Docker, not a complete hostile-code sandbox. Docker allowlists are not natively enforced by the adapter, so allowlist requests are recorded as unsupported/best-effort notes.

Filesystem policy may be native in some sandbox providers and emulated in local adapters. Secrets policy denies env keys not listed in `policy.secrets.allowed` when that policy exists. `policy.secrets.redactFromLogs` redacts configured env secret values from Capsule-observed output and errors. `policy.secrets.redactionProfile: "strict"` also redacts common token-shaped strings in logs, receipt metadata, and provider options; `redactKeys` adds project-specific key names to the receipt redaction set.

Limit policy includes timeout, output size, memory, and CPU. Timeout is straightforward for local process management; memory and CPU depend on provider support.

Approval policies fail closed in core when `policy.approvals.required` is set and the operation spec does not include `approval: { approved: true, ... }`. Approval grants can carry an approval id, approver, reason, `approvedAt`, `expiresAt`, allowed `capabilities`, scoped `resources`, and small metadata for audit context. Expired grants, invalid expiry timestamps, capability mismatches, and resource-scope mismatches are denied before provider execution. TTL policy fails closed in core when a request includes `ttlMs` above `policy.ttl.maxMs`; provider-side cleanup still depends on adapter/provider lifecycle support.

## Policy Explain

`explainPolicy(policy, input)` returns an allowed or denied decision without throwing and without executing an adapter action. Denied reports include the violation reason and violating fields; allowed reports include the same notes `evaluatePolicy` would record in receipts.

The CLI exposes the same dry-run path:

```bash
capsule policy explain --adapter docker --capability job.run --policy-file policy.json --spec-file job-spec.json
```

The policy file contains a `CapsulePolicy` JSON object. The spec file contains policy input such as `env`, `timeoutMs`, `ttlMs`, `approval`, or `resource`. The output includes the adapter support level for the requested capability and summarizes env keys instead of printing env values.

Cost policies are control-plane constraints. Adapters should record whether enforcement is native, delegated, emulated, or unsupported.

Cloud providers must not be described as OS-level enforcement unless the provider API actually supplies that guarantee. For Cloud Run, ECS/Fargate, Kubernetes, Lambda, Fly Machines, Azure Container Apps, Vercel, Cloudflare, Neon, and EC2, Capsule receipts describe what Capsule requested and observed, plus whether enforcement was delegated to the provider, emulated by the adapter, unsupported, or best-effort.
