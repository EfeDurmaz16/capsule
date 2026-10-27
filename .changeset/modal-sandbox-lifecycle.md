---
"@capsule-sdk/modal": minor
---

Modal sandbox lifecycle fixes.

- `sandbox.destroy()` now calls the SDK's `terminate({ wait: true })` and writes the `deleted` receipt only after the sandbox reached a terminal state (receipt metadata `terminateWait: true` and the sandbox `exitCode`). The wait is bounded by the new `terminateDeadlineMs` adapter option (default 60000). When it expires destroy rejects with `PendingOperationError` carrying the sandbox locator and writes no receipt. A failed terminate rejects with the classified provider error.
