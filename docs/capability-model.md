# Capability Model

Capsule capability paths use dot notation, such as `sandbox.exec`, `service.deploy`, `edge.deploy`, `database.branchCreate`, and `machine.create`.

`supportLevel(path)` returns the declared support level. `supports(path)` returns true for `native`, `emulated`, and `experimental`, and false for `unsupported`.

Examples:

- Docker: `sandbox.exec` is native, `sandbox.filesystemPolicy` is emulated, `sandbox.networkPolicy` is experimental, `service.deploy` is unsupported.
- E2B: `sandbox.create`, `sandbox.exec`, and sandbox file operations are native through the E2B SDK; jobs remain unsupported until Capsule models an explicit E2B-backed job flow.
- Modal: sandbox and jobs are native, service and preview are experimental.
- Cloud Run: jobs and services are native through the real Cloud Run Admin API adapter; logs, IAM/public access, and source builds are intentionally not faked.
- Vercel: edge deployment is native through the real Vercel REST adapter; service/preview semantics remain experimental and aliases, env, logs, and rollback are not faked.
- Cloudflare: edge is native; sandbox, job, service, database, and preview are experimental.
- Real Cloudflare adapter: `edge.deploy` is native for Worker module upload; routes, logs, secrets, versions, and rollback are unsupported until modeled as explicit operations.
- Neon: database branch creation and connection strings are native.
- Lambda: existing function invoke is native for `job.run`; deployment, environment mutation, and Lambda@Edge remain future explicit capabilities.
- Kubernetes: jobs and services are native through the real Kubernetes adapter; sandbox/machine support remains experimental because cluster/runtime configuration is leaky.
- EC2: machines are native; jobs and services are emulated.
