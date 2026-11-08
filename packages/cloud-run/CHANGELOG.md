# @capsule-sdk/cloud-run

## 0.2.0

### Minor Changes

- d4f0ec1: Truthful long-running operations and bounded HTTP for the Cloud Run adapter.

  - `service.delete` reports `deleted` only for a done delete operation, observing it with repeated `operations.wait` calls inside `operationDeadlineMs`; otherwise it throws `PendingOperationError`. With `waitForOperations: false` a delete that is not done is pending, not deleted.
  - `job.run` always observes job creation and never calls `:run` after a failed or unfinished create. The returned id is the real Execution from the run operation response or metadata; when none is reported yet it throws `PendingOperationError` with the run operation name instead of returning the Job name.
  - `job.cancel` keeps the Execution id (cancel returns an Operation) and reports `cancelled` only when the done operation shows it.
  - `healthcheck.command` is rejected on deploy and update instead of replacing the container entrypoint.
  - Full resource names must match the configured project (or the new `projectNumber`) and location; short ids must be one path segment.
  - Requests check status before parsing JSON, read bounded bodies (`maxResponseBytes`), and time out after `requestTimeoutMs`. A timed-out mutation is `UnknownOutcomeError`.
  - The adapter reuses one client and Google auth client; tokens still refresh per request through the auth library.

### Patch Changes

- fc02fac: Deleting an already-absent Neon branch or Cloud Run service is now idempotent success instead of a leaked disposition, matching the Azure adapter; core exports the shared `providerErrorStatus` helper. The Lambda adapter throws `AdapterExecutionError` for missing function names instead of a bare `Error`, and `cloudRun()` accepts zero arguments like its siblings.
- f1795f8: Obtaining the Application Default Credentials token is now bounded by the request it serves. `google-auth-library`'s `getRequestHeaders` takes no AbortSignal, so the adapter cannot cancel a token refresh; it now stops waiting for it at `requestTimeoutMs` or at the `operationDeadlineMs` observation deadline, never sends the request, and reports a retryable error (`PendingOperationError` inside an operation observation). Before, a hung refresh outside an observation never ended, and a refresh that finished after the deadline still started the request. The refresh itself may finish later in the background. Configurations with `accessToken` are unaffected.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 78f0b9a: Add optional log cursor pagination and log source attribution to the core log surface. `JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` gain an optional `cursor`, their results gain an optional `nextCursor`, and `LogEntry` gains an optional `source` for instance attribution. Both additions are optional and backward compatible.

  Cloud Run wires the cursor through Cloud Logging `pageToken`/`nextPageToken`. Kubernetes wires it through the pod list `continue` token and tags each combined log line with its source pod name. Docker tags `sandbox.exec` result logs with the container id. Cloudflare edge logs stay `unsupported` with a documented rationale (live tail is WebSocket-only; the bounded telemetry query API is opt-in and its event schema is unversioned). New `docs/log-normalization.md` consolidates the per-provider mapping and states that captured logs are best-effort bounded snapshots, not complete transcripts.

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

- bc2c86f: Add bounded Cloud Run job and service log reads through Cloud Logging entries:list.
- 0501a7a: Add the generic service rollback contract and Cloud Run service update and rollback support.
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
