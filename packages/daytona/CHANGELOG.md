# @capsule-sdk/daytona

## 0.2.0

### Minor Changes

- 8d6ac02: Daytona sandbox correctness fixes.

  - `listFiles(path)` now builds each entry path from the requested directory and the SDK `FileInfo.name` (the installed SDK returns no path field), so `/workspace/build` lists `/workspace/build/out.txt` and relative `build` lists `build/out.txt`. Entry types come from `FileInfo.isDir`.
  - `sandbox.artifacts` and `sandbox.snapshot` are now declared `unsupported`. `ExecSpec.artifactPaths` was never collected (always `[]`) and Capsule has no snapshot API.
  - A failed `exec` no longer deletes the sandbox. The sandbox is caller-owned and may be a persistent workspace; its lifetime is decided only by `destroy()`. A nonzero exit was already a normal result. A refused request (auth, validation, rate limit) rejects with the typed provider error; any other exec failure (timeout, dropped connection, unknown server error) rejects with `UnknownOutcomeError` (`retrySafe: false`) carrying the sandbox locator, because the command may already have run. Allocation rollback in `create()` is unchanged.
  - Network allowlists are validated before any provider call. Daytona `networkAllowList` accepts CIDR ranges only, so an `allowedHosts` entry that is a host or domain name now rejects `create()` with `PolicyViolationError` instead of being sent as a CIDR. An allowlist with no entries maps to `networkBlockAll: true` instead of an empty allowlist that left the network open.
  - `exec({ input })` now rejects with `UnsupportedCapabilityError` (`sandbox.exec.input`) before any provider call instead of silently dropping the input. The installed SDK `executeCommand` has no stdin parameter.
  - `writeFile` with bytes now passes a `Buffer` view over the caller's memory (same `byteOffset`/`byteLength`) instead of copying it. Do not mutate the bytes until `writeFile` resolves. Strings are still encoded to a `Buffer`, because the SDK treats a string source as a local file path.

### Patch Changes

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 951af73: Adopt the provider error taxonomy across every adapter. Core adds `classifySdkError`, `asProviderError`, and `callProvider` so SDK-based adapters normalize provider error shapes (status codes, error names/codes) into the shared retryable/rate-limit/auth/validation categories. The docker, kubernetes, lambda, ec2, ecs, e2b, daytona, modal, and mock adapters now attach `cause.providerError` on failures instead of throwing raw errors, so callers get the same typed categories the six HTTP adapters already emitted. Docker classifies conservatively from CLI exit codes and stderr signals. Each adapter contract test now exercises the shared failure-scenario harness with a real scenario, and the Azure Container Apps client gains explicit classification tests.
- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [fbae6f0]
- Updated dependencies [70cee7f]
- Updated dependencies [0f6ef03]
- Updated dependencies [42953dc]
- Updated dependencies [6488af5]
- Updated dependencies [45d50ee]
- Updated dependencies [a0d12be]
- Updated dependencies [1488e6a]
- Updated dependencies [fd7307a]
- Updated dependencies [e65957b]
- Updated dependencies [cf1ba2a]
- Updated dependencies [b14410b]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [467b824]
- Updated dependencies [951af73]
- Updated dependencies [2dc1196]
- Updated dependencies [575c614]
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
  - @capsule-sdk/core@0.2.0

## 0.1.1

### Patch Changes

- 9f060c1: Restrict published package files and add release provenance hardening.
- f8848c0: Add explicit public npm publish configuration and Changesets release infrastructure.
- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
