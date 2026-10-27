---
"@capsule-sdk/modal": minor
---

Modal sandbox lifecycle fixes.

- `sandbox.destroy()` now calls the SDK's `terminate({ wait: true })` and writes the `deleted` receipt only after the sandbox reached a terminal state (receipt metadata `terminateWait: true` and the sandbox `exitCode`). The wait is bounded by the new `terminateDeadlineMs` adapter option (default 60000). When it expires destroy rejects with `PendingOperationError` carrying the sandbox locator and writes no receipt. A failed terminate rejects with the classified provider error.
- `sandbox.create()` terminates the sandbox it allocated when a later step such as receipt signing fails, so no sandbox is left without a handle. A confirmed or still-pending termination rejects with `PartialEffectsError` (cause is the original error); a failed termination rejects with `CleanupFailureError` whose `effects` lists the residual sandbox.
- `sandbox.artifacts`, `sandbox.streamingLogs`, `sandbox.snapshot` and `sandbox.exposePort` are now declared `unsupported`. The Capsule sandbox has no streaming or snapshot API, `exposedPorts` is not mapped and `ExecSpec.artifactPaths` was never collected (always `[]`).
- Network allowlists are validated before any provider call. Modal `cidrAllowlist` accepts CIDR ranges only, so an `allowedHosts` entry that is a host or domain name now rejects `create()` with `PolicyViolationError` before the app is resolved. An allowlist with no entries (or no `allowedHosts`) maps to `blockNetwork: true` instead of an open network.
