# @capsule-sdk/fly

## 0.2.0

### Minor Changes

- df0632d: The Fly client checks the HTTP status before parsing, so an HTML or text error page (for example a 503 maintenance page) now raises the typed provider error with its status and `Retry-After` instead of a `SyntaxError`. Error bodies are read up to 64 KiB and are never echoed raw. Successful bodies are read incrementally up to `maxResponseBytes` (default 16 MiB, `CaptureLimitError` beyond it) and every request has a client deadline `requestTimeoutMs` (default 60000 ms) that also cancels a stalled body. A timed-out GET is a retryable provider error; a timed-out mutation is an `UnknownOutcomeError` because the provider may already have applied it. A malformed successful body is an `AdapterExecutionError`.
- 50858a5: Machine status follows the documented Fly Machine states instead of reporting `failed` for normal transitions. `creating` maps to `creating`; `starting`, `restarting`, `updating` and `replacing` map to `starting`; `stopping` and `suspending` map to `stopping`; `destroying` maps to `destroying`; `launch_failed` maps to `failed`. The native state stays in `metadata.state`. An unrecognized native state now throws from `machine.status` instead of being reported as `failed`.

  `machine.start` and `machine.stop` read the real acknowledgement bodies (`{ previous_state }` and `{ ok }`) and report `starting` and `stopping`; a status read confirms the stable state. An empty success body no longer throws a TypeError.

### Patch Changes

- fbae6f0: Bounded body readers (`readBoundedText`, the Cloudflare, Fly, Neon and Vercel HTTP clients and the Vercel runtime log reader) no longer call `releaseLock()` on a body they finished, cancelled or saw fail. In Node, `releaseLock()` builds an error whose first use creates a `vm` context, about 1 ms on the first request of a process. The body stays locked, which only matters to code that tried to read a body the client already consumed. Results and caps are unchanged.
- bc69c09: `job.run` now sends `auto_destroy` inside the Machine `config`, where the Fly Machines API reads it, instead of as an ignored top-level field. Ordinary `machine.create` still does not request auto-destroy.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- d561f4c: A capture deadline, observation deadline or interval, or HTTP `requestTimeoutMs` of 2^31 ms (about 24.8 days) or more no longer expires after 1 ms. Node fires a longer `setTimeout` after 1 ms; these timers now wait the largest delay Node supports instead.
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
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [467b824]
- Updated dependencies [951af73]
- Updated dependencies [2dc1196]
- Updated dependencies [575c614]
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
  - @capsule-sdk/core@0.2.0

## 0.1.1

### Patch Changes

- 9f060c1: Restrict published package files and add release provenance hardening.
- f8848c0: Add explicit public npm publish configuration and Changesets release infrastructure.
- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
