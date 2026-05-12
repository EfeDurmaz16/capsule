# Sandbox Model

A sandbox is a bounded execution workspace. Capsule models creation, command execution, file reads and writes, file listing, upload/download, logs, artifacts, port exposure, snapshots, workspace mounts, and destruction.

Provider categories include local Docker containers, E2B sandboxes, Daytona workspaces, Modal sandboxes, Cloudflare Sandbox, Microsandbox, and future Firecracker or microVM adapters.

Policy concerns include network access, filesystem boundaries, secret injection, output redaction, timeout, CPU, memory, and artifact collection. Capsule can validate and record policy decisions, but the actual isolation strength depends on the provider.

Docker local is useful for development and CI, but it is not safe for hostile untrusted code unless configured carefully outside Capsule. Capsule will not claim OS-level isolation when it is only invoking Docker CLI.

Docker sandbox creation supports requested `exposedPorts`. Capsule maps each request to Docker `--publish` flags and binds to `127.0.0.1` by default, so published ports are local-only unless the caller explicitly supplies another `hostIp`. This does not turn Docker into a remote service provider and does not bypass `network.none`; it only describes host-loopback port publishing for local development and CI.

Docker sandbox snapshots and restore are explicitly unsupported. Docker has lower-level image and container commit mechanisms, but Capsule does not expose a public snapshot/restore API today and does not model portable restore semantics, filesystem consistency, running-process state, or policy/audit continuity for Docker sandboxes. The Docker adapter must keep `sandbox.snapshot` and `sandbox.restore` unsupported until those semantics are implemented as public Capsule operations with tests.

The E2B adapter uses the official E2B SDK for cloud sandbox creation, command execution, file read/write/list, and sandbox destruction. Network `none` maps to E2B's internet-access control for the sandbox; host allowlists and OS-level filesystem policy remain provider-specific or adapter-boundary concerns.

The E2B live integration test is opt-in. It is skipped unless both `CAPSULE_LIVE_TESTS=1` and `E2B_API_KEY` are set. The test creates a real E2B sandbox, executes a command, writes/reads/lists a file, and destroys the sandbox in cleanup. Do not set `CAPSULE_LIVE_TESTS=1` in routine local or CI runs unless live provider operations are intended.

The Daytona adapter uses the official Daytona TypeScript SDK for cloud sandbox creation, command execution, file read/write/list, and deletion. Capsule maps `network.none` to Daytona network blocking and `allowlist` to Daytona's network allow list request, while keeping filesystem policy as adapter-boundary enforcement.

The Daytona live integration test is opt-in. It is skipped unless both `CAPSULE_LIVE_TESTS=1` and `DAYTONA_API_KEY` are set. The test creates a real Daytona sandbox, executes commands, writes/reads/lists a file, and calls destroy in a `finally` block. Cleanup is best-effort because provider-side delete can still fail during outages or credential revocation, so interrupted live runs should be checked in the Daytona console before rerunning.

The Modal adapter uses the Modal JavaScript SDK for sandbox creation, command execution, file read/write, and termination. Modal's public sandbox file listing surface is not modeled as a stable high-level method in this adapter, so `sandbox.fileList` remains unsupported instead of being faked.
