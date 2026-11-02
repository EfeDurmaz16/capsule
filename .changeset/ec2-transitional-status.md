---
"@capsule-sdk/ec2": minor
---

`machine.status` now reports EC2 transitional states faithfully: `stopping` maps to `stopping` (was `stopped`) and `shutting-down` maps to `destroying` (was `deleted`), in both the result and the receipt resource. `pending` stays `creating`. An unrecognized or missing native instance state now throws an `AdapterExecutionError` that carries the native value instead of being reported as `failed`. `metadata.awsState` still carries the native state. Callers that treated `stopped` or `deleted` as complete must now wait for those values explicitly.
