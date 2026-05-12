# Capability Model

Capsule capability paths use dot notation, such as `sandbox.exec`, `service.deploy`, `edge.deploy`, `database.branchCreate`, and `machine.create`.

`supportLevel(path)` returns the declared support level. `supports(path)` returns true for `native`, `emulated`, and `experimental`, and false for `unsupported`.

Examples:

- Docker: `sandbox.exec` is native, `sandbox.filesystemPolicy` is emulated, `sandbox.networkPolicy` is experimental, `service.deploy` is unsupported.
- E2B: `sandbox.create`, `sandbox.exec`, and sandbox file operations are native through the E2B SDK; jobs remain unsupported until Capsule models an explicit E2B-backed job flow.
- Modal: sandbox and jobs are native, service and preview are experimental.
- Cloud Run: jobs and services are native, previews are experimental.
- Vercel: edge is native, service and preview are experimental.
- Cloudflare: edge is native; sandbox, job, service, database, and preview are experimental.
- Neon: database branch creation and connection strings are native.
- Lambda: jobs are native and edge is experimental.
- EC2: machines are native; jobs and services are emulated.
