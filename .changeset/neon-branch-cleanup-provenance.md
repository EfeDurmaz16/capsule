---
"@capsule-sdk/neon": patch
---

When connection URI retrieval fails after a branch was created and the compensating branch delete also fails, `database.branch.create` now throws `CleanupFailureError` with the primary error as `cause` and a partial-effects record (`partialEffectsOf(error)`) naming the created branch as residual. An unconfirmed delete (for example a timeout) throws `PartialEffectsError` with cleanup status `unknown`. A successful or already-absent cleanup still rethrows the primary error unchanged.
