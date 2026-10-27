---
"@capsule-sdk/preview": patch
---

The aggregate `preview.create` receipt from `createPreviewGraph` now starts its clock before the first provisioning call, so `startedAt` and `durationMs` cover the provider work instead of reporting about 0 ms. Benchmarks should still measure their own wall clock independently of receipt durations.
