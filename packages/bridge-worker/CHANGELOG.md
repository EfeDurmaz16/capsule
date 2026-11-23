# @capsule-sdk/bridge-worker

## 0.1.0

### Minor Changes

- cc1283b: New package: a Capsule provider worker for the Fabric bridge protocol v1. It reads and writes u32 little-endian length-prefixed JSON frames (1 MiB from Fabric and for the handshake, 16 MiB for other worker frames, caps checked before a body is buffered), negotiates the protocol version, capability profile and limits in a hello, and then runs one governed sandbox action per request. Every refusal (schema, action outside the profile, locator scope, owner, policy, secrets, fresh approval, idempotency conflict) is answered with effect none before any provider call. Accepted work goes through the Capsule facade, so policy and the per-operation grant are checked again before the adapter runs. Terminal-only actions answer only after a terminal state was observed and otherwise answer pending with the scoped locator; an action whose effect cannot be known answers unknown with the best known locator. The worker keeps no durable state, never retries an effect, and never treats losing its connection as a cancel. Two profiles ship: `fixture`, a deterministic in-memory provider on a virtual clock that records every effect for tests, and `docker`, which uses the Docker adapter with `pull: never`, sends every docker command to the bound docker context, labels containers with the operation, job, attempt and generation, and finds an earlier create by label after a worker restart. On the wall clock every answer comes within the request's `deadline_ms`, and work that goes on after its answer keeps counting against the in-flight limit. The docker create, start and rm clients run in a process group of their own, so Fabric ending a lost worker's process group cannot abort the daemon's work, while an attached docker exec client ends with the worker. An `attach` finds what an earlier create of an operation made, by the operation's key (fixture) or its `fabric.operation` label (Docker), checks its owner labels, and answers `completed` or `pending` with the locator, or `unknown`/`absent` with the scope it searched; it makes no mutating call and never creates, so a create whose answer was lost is found instead of made again, and its cleanup is an ordinary destroy that needs a fresh grant. The `capsule-bridge-worker` bin serves one profile per process on stdin and stdout.
- f9b1522: Add `listResiduals(driver, { live, ended })` to the worker's internal API: the Docker and fixture profiles list what carries the operation label in the bound scope. Only an owner the caller ended and holds no longer live is a residual; an owner it does not name, such as another daemon's job on the same engine, is kept as `unknown`. It changes nothing and is not a v1 message.
- 6f7b115: Trace Fabric-driven operations. When the worker process registered an OpenTelemetry SDK (`node --import`), every request gets the Capsule spans of its operation with `fabric.operation.id`, `fabric.job` and `fabric.request.id` attributes and a link to a span context derived from the Fabric operation id (first 48 hex of `sha256("fabric.operation:" + id)`); a `TRACEPARENT` in the environment adds a link to the spawning session. A request refused before any Capsule span started gets a span of its own; an idempotent replay of a stored answer adds none. The worker reads the tracer from the provider the SDK registered, so it imports no OpenTelemetry package and traces wherever it is installed.

### Patch Changes

- 0f03b21: Bridge protocol v1 corrections of 2026-11-03, with their shared fixtures. A request target or observe resource without a `native_id` (absent, null or empty) is `invalid`/`missing_field` instead of `bad_locator`, and an approval grant with an empty `native_id` is refused at config time. Both profiles advertise `max_timeout_ms` (fixture 60000 ms, docker 3600000 ms) and refuse an exec `timeout_ms` above it as `invalid`/`limit`. An observe of a create or a destroy whose one read finds no resource in the bound scope answers `unknown`/`absent` with the scope it searched (it answered `not_found` for a create and `completed`/`destroyed` for a destroy); a destroy the provider answers `not_found` stays a bare `not_found`, and `searched` is accepted only on `unknown`/`absent`. Fabric settles a `not_found` destroy on the absent answer to its observe, and the worker keeps no ledger of earlier reads.
- 9ed60f4: Stop packing declaration files the package's `types` entry never reaches, and declaration maps for core and docker, which pointed at sources the packages do not ship. What a consumer can import is unchanged.
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
- Updated dependencies [f82ce34]
- Updated dependencies [77f3c8b]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [9c9340d]
- Updated dependencies [9ed60f4]
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
