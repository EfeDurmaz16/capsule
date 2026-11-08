# @capsule-sdk/cloudflare

## 0.2.0

### Minor Changes

- 4aba7ff: The Cloudflare client checks the HTTP status before parsing, so an HTML or text error page (for example a 503 maintenance page) now raises the typed provider error with its status and `Retry-After` instead of a `SyntaxError`. Error bodies are read up to 64 KiB and are never echoed raw. Successful bodies are read incrementally up to `maxResponseBytes` (default 16 MiB, `CaptureLimitError` beyond it) and every request has a client deadline `requestTimeoutMs` (default 60000 ms) that also cancels a stalled body. A timed-out GET is a retryable provider error; a timed-out mutation is an `UnknownOutcomeError` because the provider may already have applied it. A malformed successful body is an `AdapterExecutionError`.
- bcb76a4: When a route fails after the Worker upload in `edge.deploy`, the error now reports every effect instead of only the route error. If removing the routes created by the call fails, it throws `CleanupFailureError`; otherwise it throws `PartialEffectsError`. In both cases `cause` is the original route error and `partialEffectsOf(error)` returns the uploaded Worker, the created routes, the cleanup outcome and the residual resources. The uploaded Worker is still not deleted, because the upload may have replaced an existing Worker. Callers that matched the route error class directly should read `error.cause` instead.

### Patch Changes

- fbae6f0: Bounded body readers (`readBoundedText`, the Cloudflare, Fly, Neon and Vercel HTTP clients and the Vercel runtime log reader) no longer call `releaseLock()` on a body they finished, cancelled or saw fail. In Node, `releaseLock()` builds an error whose first use creates a `vm` context, about 1 ms on the first request of a process. The body stays locked, which only matters to code that tried to read a body the client already consumed. Results and caps are unchanged.
- ce5ce4e: `edge.rollback` without `targetVersionId` now infers the target only when the previous Worker deployment served exactly one version at 100%. A previous traffic split (for example 10/90) is rejected with an error naming the split instead of silently promoting one of its versions to 100%. An explicit `targetVersionId` behaves as before.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 78f0b9a: Add optional log cursor pagination and log source attribution to the core log surface. `JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` gain an optional `cursor`, their results gain an optional `nextCursor`, and `LogEntry` gains an optional `source` for instance attribution. Both additions are optional and backward compatible.

  Cloud Run wires the cursor through Cloud Logging `pageToken`/`nextPageToken`. Kubernetes wires it through the pod list `continue` token and tags each combined log line with its source pod name. Docker tags `sandbox.exec` result logs with the container id. Cloudflare edge logs stay `unsupported` with a documented rationale (live tail is WebSocket-only; the bounded telemetry query API is opt-in and its event schema is unversioned). New `docs/log-normalization.md` consolidates the per-provider mapping and states that captured logs are best-effort bounded snapshots, not complete transcripts.

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
- Updated dependencies [f82ce34]
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
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
  - @capsule-sdk/core@0.2.0

## 0.1.1

### Patch Changes

- 409969c: Require an explicit Cloudflare Worker script name for rollback operations.
- 754f2da: Add Cloudflare Workers version upload and rollback through Workers deployments.
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
