---
"@capsule-sdk/neon": minor
---

`database.branch.create` and `database.branch.reset` no longer report `ready` while Neon is still running background operations. A branch is `ready` only when its `current_state` is `ready`, no `pending_state` is set and every returned operation settled; otherwise create reports `creating` and reset reports `resetting`. A `failed` branch state or a failed operation reports `failed`. The receipt resource status uses the same normalized value, and receipt metadata (and reset result metadata) carry `currentState`, `pendingState` and the operation IDs.
