# @capsule-sdk/ecs

## 0.2.0

### Minor Changes

- 3b40bda: Caller `idempotencyKey` values now reach the native AWS idempotency parameter where one exists, in addition to the existing `capsule_operation_*` correlation tags. EC2 `machine.create` sends a RunInstances `ClientToken` scoped to the adapter region. ECS `job.run` sends a RunTask `clientToken` scoped to the adapter region and cluster. Each token is a 32-character hex hash, so the raw key never reaches AWS. AWS then deduplicates retries of the same request within its token window. Reusing a key with different parameters fails with the provider error (`IdempotentParameterMismatch` on EC2, `ConflictException` on ECS) instead of creating a second resource. This is provider retry deduplication, not an exactly-once guarantee, and receipts say so. ECS `service.deploy` still uses the key only as a correlation tag; service names are already unique per cluster.
- b5d1a87: A non-forced `service.delete` now waits for the scale-to-zero to finish before calling DeleteService. ECS deletes a service without `force` only when it has no running tasks, and the adapter previously sent DeleteService right after the UpdateService acknowledgment while tasks were still running. When the UpdateService response still reports running or pending tasks, the adapter observes DescribeServices until both counts are zero. If they are not zero within the `deleteObservation` budget, it throws `PendingOperationError` and sends no DeleteService. The budget is shared with the INACTIVE observation. `force: true` keeps the documented ECS behavior and deletes without waiting; Capsule never adds `force` on its own.
- 4b7ca1e: `job.status` decides the outcome of a STOPPED task from the configured `containerName` only, the container Capsule overrides with the job command. Exit code 0 is `succeeded`; any other exit code, or a missing main container or exit code, is `failed`. Previously any nonzero container failed the job and any zero exit code from a helper could mark a never-started main container as `succeeded`. `UserInitiated` stops are still `cancelled`. Status, cancel and receipt metadata now include `containers` (name, lastStatus, exitCode, reason) and `completionContainer` alongside the raw `stopCode` and `stoppedReason`.
- 80c89cb: `service.delete` no longer reports a service as `deleted` when ECS has only accepted the deletion. ECS answers DeleteService with `DRAINING` while tasks are still stopping, so the adapter now observes DescribeServices until the service is `INACTIVE`, reported `MISSING` or `ServiceNotFoundException`, and only then resolves with `status: "deleted"` and a receipt. If the bounded observation expires it throws `PendingOperationError` (`CAPSULE_OPERATION_PENDING`) with the last native status and a safe service locator, and writes no deleted receipt. The bound is configurable with the new `deleteObservation: { deadlineMs, intervalMs }` adapter option (defaults 600000 ms and 5000 ms). Result and receipt metadata gain `deletion: { acknowledgedStatus, observedTerminal, observations }`.

  The best-effort cleanup after a failed `service.deploy` now records `status: "pending"` with `providerStatus` when DeleteService answered `DRAINING`, instead of `deleted`; it reports `deleted` only for an `INACTIVE` response.

### Patch Changes

- 41120a7: Reuse one lazily created AWS SDK client per adapter instance instead of constructing a new client for every operation. Constructing the adapter still creates no client and resolves no credentials, and an injected `client` is used as is and never replaced. Reuse keeps the SDK keep-alive connection pool and credential cache across operations; no latency improvement is claimed from this change alone.
- 4f742dd: The error-classifying ECS client wrapper now forwards every argument of `send`, including the request options. It previously passed only the command, so the `abortSignal` of a `service.delete` observation never reached the AWS SDK and an expired or cancelled DescribeServices request kept running in the background. Provider errors are still classified the same way.
- 641edf5: `service.status` no longer reports `failed` only because an older deployment still shows `rolloutState: FAILED` after a newer deployment superseded it. When DescribeServices lists a FAILED deployment next to a PRIMARY deployment that did not fail, the adapter reads the service deployment named by `currentServiceDeployment` with `DescribeServiceDeployments`: a circuit-breaker or alarm rollback (`ROLLBACK_*`), a stop (`STOP_REQUESTED`, `STOPPED`) or an unknown state keeps `failed`; a newer deployment that is `PENDING`, `IN_PROGRESS` or `SUCCESSFUL` reports its own progress (`deploying` or `ready`). Without `currentServiceDeployment`, or when that read fails (for example without the `ecs:DescribeServiceDeployments` permission), the status stays `failed` as before and the reason is in `metadata.serviceDeployment`. Status metadata now also carries `currentServiceDeployment`. The second read happens only for that ambiguous shape.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
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
