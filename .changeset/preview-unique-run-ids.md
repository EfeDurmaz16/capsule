---
"@capsule-sdk/preview": minor
---

`createPreviewId` appends a random component, so two previews with the same name created in the same millisecond no longer share a preview id, cleanup plan id or cleanup idempotency keys. New optional `PreviewPlan.operationId` records a caller-stable operation identity on the cleanup plan (`operationId`) and in the `preview.create` receipt metadata. It is kept separate from the per-run preview id; cleanup idempotency keys remain scoped to the run.
