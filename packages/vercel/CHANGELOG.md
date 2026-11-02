# @capsule-sdk/vercel

## 0.2.0

### Minor Changes

- e4909ef: Runtime logs (`providerOptions.api: "runtime"`) are now read incrementally from the live runtime logs stream with the documented `format=lines` framing. The read stops at the record cap (`limit`, or `bounds.maxRecords`), the byte cap (`bounds.maxBytes`) or the deadline (`bounds.deadlineMs`, default 60000 ms), cancels the body, and reports `truncation` on the result. Records split across chunks are reassembled, malformed lines are skipped and counted in `metadata.malformedRecords`, and Vercel's runtime-limit delimiter ends the read. Previously the adapter waited for the stream to close and buffered everything.

  Runtime logs now reject `since` and `until`, because the endpoint has no history query; before, they were silently ignored. Receipt metadata records which constraints were applied and by whom (`appliedConstraints`).

  `VercelClient.readRuntimeLogs()` is new and returns records, truncation and malformed-record counts; `getRuntimeLogs()` uses it and returns the records only.

  The client also checks the HTTP status before parsing, so an HTML or text error page keeps its status, `Retry-After` and typed retry category. Error bodies are read up to 64 KiB and never echoed raw; successful bodies are bounded by `maxResponseBytes` (default 16 MiB) and each request by `requestTimeoutMs` (default 60000 ms). A timed-out mutation raises `UnknownOutcomeError`.

### Patch Changes

- fbae6f0: Bounded body readers (`readBoundedText`, the Cloudflare, Fly, Neon and Vercel HTTP clients and the Vercel runtime log reader) no longer call `releaseLock()` on a body they finished, cancelled or saw fail. In Node, `releaseLock()` builds an error whose first use creates a `vm` context, about 1 ms on the first request of a process. The body stays locked, which only matters to code that tried to read a body the client already consumed. Results and caps are unchanged.
- d561f4c: A capture deadline, observation deadline or interval, or HTTP `requestTimeoutMs` of 2^31 ms (about 24.8 days) or more no longer expires after 1 ms. Node fires a longer `setTimeout` after 1 ms; these timers now wait the largest delay Node supports instead.
- 004c553: Runtime log reads count record and pending-line sizes with `Buffer.byteLength` instead of encoding a copy, and no longer encode a whole array line whose size is not used. Byte caps and results are unchanged.
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
- 0a3331f: Add Vercel edge log collection through deployment event logs and project runtime logs.
- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
