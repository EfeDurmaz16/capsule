---
"@capsule-sdk/preview": minor
---

Add a fresh per-action cleanup approval resolver. `cleanupPreviewEnvironment(..., { approval })` and `createPreviewEnvironmentWithCleanup(plan, { cleanupApproval })` call a `CleanupApprovalResolver` before each delete with the capability path and the exact resource scope Capsule core checks. A returned grant is sent on that delete only; `undefined` denies it, sends no delete and reports the resource as `leaked`. Create grants are never reused for cleanup. Without a resolver, behavior is unchanged.
