---
"@capsule-sdk/lambda": minor
---

`job.run` now rejects the `invocationType: "DryRun"` adapter option with an `AdapterExecutionError` before calling AWS. A DryRun Invoke only validates parameters and permissions and runs no code, but its 204 response was reported as a `succeeded` job with exit code 0 and a successful receipt.
