# @capsule-sdk/kubernetes

## 0.2.0

### Minor Changes

- d4f0ec1: Truthful deletes, bounded logs and stricter validation for the Kubernetes adapter.

  - `service.delete` deletes the Deployment and the Service independently (404 per resource means already absent) and reports `deleted` only after both are observed gone. An accepted foreground delete still terminating at `operationDeadlineMs` (default 120000) throws `PendingOperationError`. A partial failure throws `PartialEffectsError` with both locators. Clients used for delete now need `readNamespacedDeployment` and `readNamespacedService`.
  - A deploy whose Service step fails reports the Deployment rollback outcome (`PartialEffectsError`, or `CleanupFailureError` when the rollback failed) instead of swallowing it. The original error stays the primary error.
  - Job and service logs honor `bounds`: each pod read is a bounded tail with `limitBytes`, at most `bounds.concurrency` reads run at once, and results carry `truncation`. Kubelet applies `limitBytes` forward from the start of the tail, so when a tail does not fit in `bounds.maxBytes` the adapter reads again with a shorter tail until the newest lines fit; every read stays bounded by `maxBytes`. Entries are merged by nanosecond timestamp before `limit`, so the newest entries win regardless of pod order. The Kubernetes log API has no end-time filter, so `until` is applied to the bounded tail: when that tail is full and filters down below the requested size, older matching lines were not read and the result is marked truncated (`reason: "records"`) instead of complete. This is a weaker guarantee than reading the whole log, which the previous unbounded read did. Every literal env value on every selected pod is redacted, not one value per name.
  - `job.run` no longer returns a placeholder `result` with exit code 0 for a Job that only started.
  - Service ports get unique names (`http-8080`); duplicate or invalid ports, `healthcheck.command`, and `scale.max` different from the replica count are rejected before any request. Names are validated after truncation, Service names must start with a letter, and generated job names include random bits.
  - The kubeconfig is parsed and API clients are built once per adapter. Set `reloadKubeconfigPerOperation: true` to reread it for every operation.

### Patch Changes

- 6c9edbd: The `service.delete` observation now hands its deadline signal to every Deployment and Service GET it makes. The installed `@kubernetes/client-node` takes no signal argument, so the adapter passes per-request options whose middleware sets the request's AbortSignal, appended after the middleware the client was built with. When `operationDeadlineMs` expires, the GET still in flight is cancelled instead of left running in the background, and the call still ends with `PendingOperationError`. Injected clients receive the options as a second argument; one that ignores them is abandoned at the deadline, as before.
- faa6dc7: A log capture whose first page (no `cursor`) misses `bounds.deadlineMs` before the Service or Job selector or the pod list was read now returns a `nextCursor` that reads the first page again. Before, it returned no cursor, which `JobLogsResult` defines as "no more pages", so a pager stopped after reading zero pods. Cursors stay opaque: a continue token from the API server is handed back unchanged, and cursors from earlier versions keep working. The reverse does not hold: the first-page cursor is new, and an earlier `@capsule-sdk/kubernetes` would send it to the API server as a continue token, so a persisted cursor must only be passed back to the version that issued it or a newer one.
- 6a08ec3: A request whose deadline has already passed when `@kubernetes/client-node` finishes authenticating it is now dropped before the HTTP library sees it, so nothing reaches the API server late. The client applies authentication while it builds the request, before the per-request middleware attaches the deadline's signal, and a kubeconfig exec credential plugin (`aws eks get-token`, the GKE auth plugin) that hangs there cannot be cancelled: its process may outlive `operationDeadlineMs` or the log capture `bounds.deadlineMs`. Capsule stops waiting at the deadline as before; this SDK limit is now documented on the adapter options and in the provider quickstart.
- 0e9066a: `service.logs` and `job.logs` now bound the pod list with `bounds.deadlineMs` and cancel the requests still in flight. The pod list was awaited with no deadline, so a slow or hung list was not bounded at all; it now ends at the deadline with no logs, `truncation.reason: "deadline"` and `nextCursor` set to the cursor of the page that was not read. Pod log reads still in flight at the deadline, or when another read fails the capture, are cancelled through the same per-request AbortSignal middleware instead of left open after the call returns.
- 0fd7cd3: Pod log collection keeps the newest entries with one sort per window of kept entries instead of one sort per source, parses the kubelet's UTC timestamps without regular expression matches, redacts only the env values that occur in a line, and counts UTF-8 bytes without encoding copies. The result, ordering, redaction and truncation are unchanged.
- d996e65: A log capture whose pod list was read in time but whose pod log reads miss `bounds.deadlineMs` now returns the cursor of that same page: the `cursor` the call was given, or the first-page cursor. Before, it returned the next page's continue token (the pods not read were skipped for good) or, on the last page, no cursor at all (the deadline read as the end of paging). `truncation.reason` is `"deadline"` as before; the next call reads the whole page again.
- b82bc6a: `service.logs` and `job.logs` now read the Service or Job that names the pod selector under `bounds.deadlineMs` and its AbortSignal. That read ran before the capture deadline started and had no signal, so an API server that never answered left the call pending forever. It now ends at the deadline with no logs, `truncation.reason: "deadline"` (or `CaptureLimitError` with `overflow: "error"`) and `nextCursor` set to the cursor of the page that was not read, and the GET is cancelled. Follow, limit, since and until are now validated before the read, so invalid input makes no request.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 78f0b9a: Add optional log cursor pagination and log source attribution to the core log surface. `JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` gain an optional `cursor`, their results gain an optional `nextCursor`, and `LogEntry` gains an optional `source` for instance attribution. Both additions are optional and backward compatible.

  Cloud Run wires the cursor through Cloud Logging `pageToken`/`nextPageToken`. Kubernetes wires it through the pod list `continue` token and tags each combined log line with its source pod name. Docker tags `sandbox.exec` result logs with the container id. Cloudflare edge logs stay `unsupported` with a documented rationale (live tail is WebSocket-only; the bounded telemetry query API is opt-in and its event schema is unversioned). New `docs/log-normalization.md` consolidates the per-provider mapping and states that captured logs are best-effort bounded snapshots, not complete transcripts.

- 951af73: Adopt the provider error taxonomy across every adapter. Core adds `classifySdkError`, `asProviderError`, and `callProvider` so SDK-based adapters normalize provider error shapes (status codes, error names/codes) into the shared retryable/rate-limit/auth/validation categories. The docker, kubernetes, lambda, ec2, ecs, e2b, daytona, modal, and mock adapters now attach `cause.providerError` on failures instead of throwing raw errors, so callers get the same typed categories the six HTTP adapters already emitted. Docker classifies conservatively from CLI exit codes and stderr signals. Each adapter contract test now exercises the shared failure-scenario harness with a real scenario, and the Azure Container Apps client gains explicit classification tests.
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

- 71772ab: Add Kubernetes Job and Service log collection from Pods matched by selectors.
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
