---
"@capsule-sdk/ec2": minor
---

`machine.create` rejects a `spec.region` that differs from the adapter `region` before any AWS request. The SDK client is bound to the adapter region, so the spec value was previously neither honored nor rejected and could mislabel the receipt. The receipt `metadata.region` now always reports the adapter region. Create a separate `ec2({ region })` adapter per region.
