# Capability Model

Capsule capability paths use dot notation, such as `sandbox.exec`, `service.deploy`, `edge.deploy`, `database.branchCreate`, and `machine.create`.

`supportLevel(path)` returns the declared support level. `supports(path)` returns true for `native`, `emulated`, and `experimental`, and false for `unsupported`.

Examples:

- Docker: `sandbox.exec` and `sandbox.exposePort` are native, `sandbox.filesystemPolicy` is emulated, `sandbox.networkPolicy` is experimental, `service.deploy` is unsupported. Docker sandbox port exposure is local-only by default: requested ports are published to `127.0.0.1` unless a caller explicitly supplies another `hostIp`.
- E2B: `sandbox.create`, `sandbox.exec`, and sandbox file operations are native through the E2B SDK; jobs remain unsupported until Capsule models an explicit E2B-backed job flow.
- Daytona: sandbox lifecycle, command execution, and file operations are native through the Daytona SDK; job and preview behavior remain unsupported until explicit public wrappers exist.
- Modal: sandbox lifecycle, command execution, and file read/write are native through the Modal JS SDK; file listing and broader function/service/preview workflows remain unsupported.
- Cloud Run: jobs and services are native through the real Cloud Run Admin API adapter; logs, IAM/public access, source builds, and preview orchestration are intentionally not faked.
- Vercel: edge deployment is native through the real Vercel REST adapter; service/preview semantics, aliases, env, logs, and rollback are not faked.
- Cloudflare: real Worker upload is native through `edge.deploy`; sandbox, job, service, database, and preview are unsupported until implemented by the real adapter.
- Real Cloudflare adapter: `edge.deploy` is native for Worker module upload; routes, logs, secrets, versions, and rollback are unsupported until modeled as explicit operations.
- Neon: database branch creation and connection strings are native.
- Lambda: existing function invoke is native for `job.run`; deployment, environment mutation, and Lambda@Edge remain future explicit capabilities.
- ECS/Fargate: existing task definitions can be run as jobs and services natively; task definition registration, load balancers, logs, and service discovery remain future explicit capabilities.
- Kubernetes: jobs and services are native through the real Kubernetes adapter; sandbox, preview, and machine support remain unsupported until explicit public wrappers exist.
- EC2: `machine.create` is native through the real EC2 adapter; job/service wrappers and exec/start/stop/snapshot remain unsupported until modeled explicitly.
