# Sandbox Model

A sandbox is a bounded execution workspace. Capsule models creation, command execution, file reads and writes, file listing, upload/download, logs, artifacts, port exposure, snapshots, workspace mounts, and destruction.

Provider categories include local Docker containers, E2B sandboxes, Daytona workspaces, Modal sandboxes, Cloudflare Sandbox, Microsandbox, and future Firecracker or microVM adapters.

Policy concerns include network access, filesystem boundaries, secret injection, output redaction, timeout, CPU, memory, and artifact collection. Capsule can validate and record policy decisions, but the actual isolation strength depends on the provider.

Docker local is useful for development and CI, but it is not safe for hostile untrusted code unless configured carefully outside Capsule. Capsule will not claim OS-level isolation when it is only invoking Docker CLI.
