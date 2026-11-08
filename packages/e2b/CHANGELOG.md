# @capsule-sdk/e2b

## 0.2.0

### Minor Changes

- 5b22cf6: Report E2B command outcomes truthfully and keep the sandbox alive.

  - A nonzero exit reported by the installed SDK as `CommandExitError` is now a normal `ExecResult` with the exit code, stdout, stderr and a `sandbox.exec` receipt. The sandbox is no longer killed when a command such as `npm test` fails.
  - Other exec failures no longer kill the sandbox. A refused request (auth, validation, rate limit) still rejects with the typed provider error. Any other failure (timeout, dropped connection, unknown server error) rejects with `UnknownOutcomeError` (`retrySafe: false`), because the command may already have run; the provider error is its `cause`.
  - `sandbox.artifacts` and `sandbox.streamingLogs` are now declared `unsupported`. The adapter never collected `ExecSpec.artifactPaths` (always `[]`) and has no streaming API, so the previous `emulated`/`experimental` levels promised behavior Capsule cannot invoke.
  - `exec({ input })` now rejects with `UnsupportedCapabilityError` (`sandbox.exec.input`) before any provider call instead of silently dropping the input. The installed SDK has no public way to close a command's stdin, so EOF cannot be delivered.
  - `writeFile` with bytes now hands the SDK a `Blob` built from the caller's view, so the bytes are copied once (the SDK passes a `Blob` through) instead of twice, and a `subarray` view uploads exactly its own bytes.

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
- Updated dependencies [f82ce34]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [9c9340d]
- Updated dependencies [9ed60f4]
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
