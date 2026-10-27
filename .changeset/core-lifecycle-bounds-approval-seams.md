---
"@capsule-sdk/core": minor
---

Add shared lifecycle, capture-bound and approval contracts for adapters.

- `Machine["status"]` is now `MachineStatus`, which adds the transitional values `starting`, `stopping` and `destroying` that machine lifecycle operations already returned. Exhaustive switches over machine status must handle them.
- New typed outcomes: `PendingOperationError` (accepted, not yet terminal), `UnknownOutcomeError` (cannot tell whether the provider applied the action, never retry-safe) and `PartialEffectsError`, plus `resourceLocator()` for safe locators and `observeUntilTerminal()` for deadline-bounded observation. `CleanupFailureError` accepts an optional structured `effects` record; `partialEffectsOf()` reads it from either class.
- New `CaptureBounds` (`maxBytes`, `maxRecords`, `deadlineMs`, `concurrency`, `overflow`) on exec and logs specs, with `truncation` on results, `CaptureBudget`, `resolveCaptureBounds`, `resolveExecOutputBounds`, `readBoundedText`, `mapWithConcurrency` and `defaultCaptureBounds`. Adapters adopt them individually.
- `ExecSpec.approval` and `sandbox.destroy({ approval })` carry a fresh per-operation grant that replaces the captured create grant for that call and is validated for its own capability and resource. The captured grant remains a validated fallback. The approval is not forwarded to adapters. `CleanupApprovalResolver` is the shared type for fresh cleanup approval.
