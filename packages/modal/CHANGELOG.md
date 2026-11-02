# @capsule-sdk/modal

## 0.2.0

### Minor Changes

- 73835ae: Modal sandbox lifecycle fixes.

  - `sandbox.destroy()` now requests termination through the SDK and writes the `deleted` receipt only after the sandbox reached a terminal state (receipt metadata carries the sandbox `exitCode`). The wait is bounded by the new `terminateDeadlineMs` adapter option (default 60000). When it expires destroy rejects with `PendingOperationError` carrying the sandbox locator and writes no receipt. A failed terminate rejects with the classified provider error.
  - `sandbox.create()` terminates the sandbox it allocated when a later step such as receipt signing fails, so no sandbox is left without a handle. A confirmed or still-pending termination rejects with `PartialEffectsError` (cause is the original error); a failed termination rejects with `CleanupFailureError` whose `effects` lists the residual sandbox.
  - `sandbox.artifacts`, `sandbox.streamingLogs`, `sandbox.snapshot` and `sandbox.exposePort` are now declared `unsupported`. The Capsule sandbox has no streaming or snapshot API, `exposedPorts` is not mapped and `ExecSpec.artifactPaths` was never collected (always `[]`).
  - Network allowlists are validated before any provider call. Modal `cidrAllowlist` accepts CIDR ranges only, so an `allowedHosts` entry that is a host or domain name now rejects `create()` with `PolicyViolationError` before the app is resolved. An allowlist with no entries (or no `allowedHosts`) maps to `blockNetwork: true` instead of an open network.
  - `exec({ input })` now delivers the input: it is written to the process stdin and stdin is closed so the command sees EOF (empty input sends only EOF). Without `input`, stdin is left untouched as before. If stdin delivery fails after the command started, exec rejects with `UnknownOutcomeError`.

- 92acb2a: Sandbox termination now sends one terminate request and polls until the sandbox has stopped. `sandbox.destroy()` and the `sandbox.create()` rollback call the SDK's `terminate()` once (no wait), then poll a fresh `client.sandboxes.fromId()` handle with `poll()` about once a second until it reports an exit code; each poll is one zero-wait request. The destroy receipt records the `exitCode` and the number of `polls` (the `terminateWait` field is gone).

  The installed modal SDK's `terminate`, `poll` and `fromId` take no AbortSignal or timeout, so `terminateDeadlineMs` is enforced between calls: no SDK call starts after the deadline and only the one zero-wait call in flight when it expires outlives it; its late answer is ignored and never writes a receipt. Inside that one call the SDK's own client retries a transient gRPC status up to three times (100, 200 and 400 ms apart), so a few more wire requests can follow the deadline before it settles. At the deadline `destroy()` rejects with `PendingOperationError` when Modal answered the terminate request (the sandbox is stopping) and with `UnknownOutcomeError` when it did not (Modal may or may not have received it). A create rollback reports its cleanup as `pending` or `unknown` in the same cases, and `PartialEffectsError` carries both. A terminate request the SDK gives up on without an answer (gRPC `CANCELLED`, `UNKNOWN`, `DEADLINE_EXCEEDED` or `UNAVAILABLE` after its retries) also rejects with `UnknownOutcomeError`, with the classified provider error as its cause; any other rejected terminate request rejects with the classified provider error, and a failed `fromId` or `poll` after an answered request is reported as pending.

  Injected `client` objects must now provide `sandboxes.fromId(sandboxId)` returning a handle with `poll()`, matching the installed SDK.

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
