---
"@capsule-sdk/preview": minor
---

Keep a failing step's leftover resources and check every child's policy before the first create.

When a create step fails with a structured partial-effects record (`CleanupFailureError` or `PartialEffectsError`), or with an unknown or pending outcome that names a resource, the resources it may have left behind are now appended to `PreviewCreationError.resources` with a new `residual` field (step order, operation, outcome and the safe provider locator). A Neon branch residual is bound to a normal `database.branchDelete` cleanup action, so compensation and later cleanup try to delete it. Residuals without a matching preview cleanup action (for example a Kubernetes Deployment or a Cloudflare Worker) are reported as `leaked`, so cleanup status is `partial` instead of `cleaned` while they may still exist. Before, the residual was dropped and cleanup reported `cleaned`.

`createPreviewGraph` and `createPreviewEnvironmentWithCleanup` now check capability support and policy for every child before the first provider call. A denial of a later child (for example an env key the secrets policy does not allow) is reported as `PreviewCreationError` with the policy error as `cause` and no resources, instead of being found after earlier children already exist.
