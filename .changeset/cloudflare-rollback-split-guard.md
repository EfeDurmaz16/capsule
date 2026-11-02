---
"@capsule-sdk/cloudflare": patch
---

`edge.rollback` without `targetVersionId` now infers the target only when the previous Worker deployment served exactly one version at 100%. A previous traffic split (for example 10/90) is rejected with an error naming the split instead of silently promoting one of its versions to 100%. An explicit `targetVersionId` behaves as before.
