---
"@capsule-sdk/core": patch
---

`mergePolicy` no longer widens a deny-all secrets policy. A `secrets` block that omits `allowed` already denies every env key at evaluation; merging it with a block that lists keys used to keep that list and permit those keys. When both sides declare a `secrets` block, the merge now intersects their effective allowlists, treating an omitted `allowed` as `[]`, so the merged policy accepts only env keys that both sides accept, in either merge order. Evaluation semantics are unchanged.
