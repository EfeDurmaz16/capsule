---
"@capsule-sdk/preview": minor
---

Bind preview cleanup to graph-local resource references instead of provider-native ids.

- Every resource created by `createPreviewGraph` and `createPreviewEnvironmentWithCleanup` gets a `ref` that is unique within the preview graph. Cleanup plan actions carry `resourceRef`, `resourceAdapter` and `resourceScope` (for example the database project), and `actionId`/`idempotencyKey` are now built from the ref, so two resources with the same native id (across providers, or across projects of one provider) get distinct actions and each one is deleted through its own Capsule with its own spec.
- `cleanupPreviewEnvironment(..., { cleanupPlan })` validates the supplied plan before the first delete. A plan whose `previewId` differs from the preview, an action whose kind, provider, native id or cleanup identity does not match its resource, or duplicate actions now throw `PreviewCleanupPlanError` with no provider calls.
- Plans serialized before `resourceRef` existed are still accepted when each action matches exactly one resource with the same kind, capability, provider, native id and cleanup identity. Ambiguous legacy plans are rejected instead of guessed.
- Receipt metadata and the plan resource list join on the graph-local ref instead of searching by native id.
