---
"@capsule-sdk/daytona": minor
---

Daytona sandbox correctness fixes.

- `listFiles(path)` now builds each entry path from the requested directory and the SDK `FileInfo.name` (the installed SDK returns no path field), so `/workspace/build` lists `/workspace/build/out.txt` and relative `build` lists `build/out.txt`. Entry types come from `FileInfo.isDir`.
- `sandbox.artifacts`, `sandbox.snapshot` and `sandbox.exposePort` are now declared `unsupported`. `ExecSpec.artifactPaths` was never collected (always `[]`), Capsule has no snapshot API and `exposedPorts` is not mapped.
- A failed `exec` no longer deletes the sandbox. The sandbox is caller-owned and may be a persistent workspace; its lifetime is decided only by `destroy()`. A nonzero exit was already a normal result. A refused request (auth, validation, rate limit) rejects with the typed provider error; any other exec failure (timeout, dropped connection, unknown server error) rejects with `UnknownOutcomeError` (`retrySafe: false`) carrying the sandbox locator, because the command may already have run. Allocation rollback in `create()` is unchanged.
- Network allowlists are validated before any provider call. Daytona `networkAllowList` accepts CIDR ranges only, so an `allowedHosts` entry that is a host or domain name now rejects `create()` with `PolicyViolationError` instead of being sent as a CIDR. An allowlist with no entries maps to `networkBlockAll: true` instead of an empty allowlist that left the network open.
