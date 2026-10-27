---
"@capsule-sdk/core": minor
---

Add shared lifecycle contracts for adapters.

- `Machine["status"]` is now `MachineStatus`, which adds the transitional values `starting`, `stopping` and `destroying` that machine lifecycle operations already returned. Exhaustive switches over machine status must handle them.
- New typed outcomes: `PendingOperationError` (accepted, not yet terminal), `UnknownOutcomeError` (cannot tell whether the provider applied the action, never retry-safe) and `PartialEffectsError`, plus `resourceLocator()` for safe locators and `observeUntilTerminal()` for deadline-bounded observation. `CleanupFailureError` accepts an optional structured `effects` record; `partialEffectsOf()` reads it from either class.
