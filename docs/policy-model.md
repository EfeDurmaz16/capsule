# Policy Model

Capsule policies cover network, filesystem, secrets, limits, cost, TTL, and approvals.

Core can validate env and secret keys, merge timeout limits, enforce approval requirements, enforce requested TTL maxima for TTL-scoped create operations, redact configured secret values from stdout, stderr, and Capsule-observed log entries, and record policy decisions. Adapters enforce what the provider can enforce. Providers enforce runtime-specific controls.

Network policy can be `none`, `allowlist`, or `all`. Docker can apply `none` with `--network none`, which removes container network access through Docker's own network mode for that container. It is still local Docker, not a complete hostile-code sandbox. Docker allowlists are not natively enforced by the adapter, so allowlist requests are recorded as unsupported/best-effort notes.

Filesystem policy may be native in some sandbox providers and emulated in local adapters. Secrets policy denies env keys not listed in `policy.secrets.allowed` when that policy exists.

Limit policy includes timeout, output size, memory, and CPU. Timeout is straightforward for local process management; memory and CPU depend on provider support.

Approval policies fail closed in core when `policy.approvals.required` is set and no approved policy input is supplied. TTL policy fails closed in core when a request includes `ttlMs` above `policy.ttl.maxMs`; provider-side cleanup still depends on adapter/provider lifecycle support.

Cost policies are control-plane constraints. Adapters should record whether enforcement is native, delegated, emulated, or unsupported.

Cloud providers must not be described as OS-level enforcement unless the provider API actually supplies that guarantee. For Cloud Run, ECS/Fargate, Kubernetes, Lambda, Fly Machines, Azure Container Apps, Vercel, Cloudflare, Neon, and EC2, Capsule receipts describe what Capsule requested and observed, plus whether enforcement was delegated to the provider, emulated by the adapter, unsupported, or best-effort.
