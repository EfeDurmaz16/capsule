# @capsule-sdk/bridge-worker

## 0.1.0

### Minor Changes

- cc1283b: New package: a Capsule provider worker for the Fabric bridge protocol v1. It reads and writes u32 little-endian length-prefixed JSON frames (1 MiB from Fabric and for the handshake, 16 MiB for other worker frames, caps checked before a body is buffered), negotiates the protocol version, capability profile and limits in a hello, and then runs one governed sandbox action per request. Every refusal (schema, action outside the profile, locator scope, owner, policy, secrets, fresh approval, idempotency conflict) is answered with effect none before any provider call. Accepted work goes through the Capsule facade, so policy and the per-operation grant are checked again before the adapter runs. Terminal-only actions answer only after a terminal state was observed and otherwise answer pending with the scoped locator; an action whose effect cannot be known answers unknown with the best known locator. The worker keeps no durable state, never retries an effect, and never treats losing its connection as a cancel. Two profiles ship: `fixture`, a deterministic in-memory provider on a virtual clock that records every effect for tests, and `docker`, which uses the Docker adapter with `pull: never`, sends every docker command to the bound docker context, labels containers with the operation, job, attempt and generation, and finds an earlier create by label after a worker restart. On the wall clock every answer comes within the request's `deadline_ms`, and work that goes on after its answer keeps counting against the in-flight limit. The docker create, start and rm clients run in a process group of their own, so Fabric ending a lost worker's process group cannot abort the daemon's work, while an attached docker exec client ends with the worker. The `capsule-bridge-worker` bin serves one profile per process on stdin and stdout.

### Patch Changes

- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [fbae6f0]
- Updated dependencies [70cee7f]
- Updated dependencies [0f6ef03]
- Updated dependencies [42953dc]
- Updated dependencies [6488af5]
- Updated dependencies [45d50ee]
- Updated dependencies [a0d12be]
- Updated dependencies [1488e6a]
- Updated dependencies [fd7307a]
- Updated dependencies [e65957b]
- Updated dependencies [cf1ba2a]
- Updated dependencies [b14410b]
- Updated dependencies [243ad90]
- Updated dependencies [048a7cf]
- Updated dependencies [9384ef9]
- Updated dependencies [44af187]
- Updated dependencies [0bc3612]
- Updated dependencies [469b9fe]
- Updated dependencies [8d79470]
- Updated dependencies [b333df7]
- Updated dependencies [8478955]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [467b824]
- Updated dependencies [951af73]
- Updated dependencies [2dc1196]
- Updated dependencies [575c614]
- Updated dependencies [f2e11e9]
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
  - @capsule-sdk/core@0.2.0
  - @capsule-sdk/docker@0.2.0
  - @capsule-sdk/store-jsonl@0.2.0
