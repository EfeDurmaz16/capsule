---
"@capsule-sdk/core": minor
"@capsule-sdk/preview": minor
---

Preview environments derive their overall status from resource statuses via the exported `aggregatePreviewStatus` (any failed resource fails the preview, pending resources keep it creating) instead of a hardcoded ready. `previewUrlRegistry` and the new optional `urlEntries` field on PreviewEnvironment map each URL back to its resource id, type, and provider.
