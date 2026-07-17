---
"@capsule-sdk/core": patch
"@capsule-sdk/neon": patch
"@capsule-sdk/cloud-run": patch
"@capsule-sdk/lambda": patch
"@capsule-sdk/ec2": patch
---

Deleting an already-absent Neon branch or Cloud Run service is now idempotent success instead of a leaked disposition, matching the Azure adapter; core exports the shared `providerErrorStatus` helper. The Lambda adapter throws `AdapterExecutionError` for missing function names instead of a bare `Error`, and `cloudRun()` accepts zero arguments like its siblings.
