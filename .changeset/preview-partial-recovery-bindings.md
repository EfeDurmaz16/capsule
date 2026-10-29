---
"@capsule-sdk/preview": minor
---

`PreviewCreationError` now carries `resources` (the resources created before the failure, with their cleanup bindings to the original Capsules), a `cleanupPlan` for exactly those resources, and their provider `receipts`. Callers of `createPreviewGraph`, which does not clean up on failure, can pass them to `cleanupPreviewEnvironment` without reconstructing provider identity. Both create variants now share one provisioning executor, so their creation order and partial-failure data are the same.
