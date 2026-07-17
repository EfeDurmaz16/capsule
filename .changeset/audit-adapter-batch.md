---
"@capsule-sdk/core": patch
"@capsule-sdk/adapter-neon": patch
"@capsule-sdk/adapter-cloud-run": patch
"@capsule-sdk/adapter-lambda": patch
"@capsule-sdk/adapter-ec2": patch
---

Deleting an already-absent Neon branch or Cloud Run service is now idempotent success instead of a leaked disposition, matching the Azure adapter; core exports the shared `providerErrorStatus` helper. The Lambda adapter throws `AdapterExecutionError` for missing function names instead of a bare `Error`, and `cloudRun()` accepts zero arguments like its siblings.
