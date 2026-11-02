# @capsule-sdk/ec2

## 0.2.0

### Minor Changes

- 3b40bda: Caller `idempotencyKey` values now reach the native AWS idempotency parameter where one exists, in addition to the existing `capsule_operation_*` correlation tags. EC2 `machine.create` sends a RunInstances `ClientToken` scoped to the adapter region. ECS `job.run` sends a RunTask `clientToken` scoped to the adapter region and cluster. Each token is a 32-character hex hash, so the raw key never reaches AWS. AWS then deduplicates retries of the same request within its token window. Reusing a key with different parameters fails with the provider error (`IdempotentParameterMismatch` on EC2, `ConflictException` on ECS) instead of creating a second resource. This is provider retry deduplication, not an exactly-once guarantee, and receipts say so. ECS `service.deploy` still uses the key only as a correlation tag; service names are already unique per cluster.
- b63ab96: `machine.create` now exports each `env` entry in the generated user-data script as a POSIX single-quoted literal, so dollars, backticks, quotes and newlines are preserved instead of being expanded by the shell that runs user data. Env names that are not valid shell identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and values containing NUL are rejected before any AWS request. The receipt now states that these exports exist only inside the user-data script process and do not persist into later logins, services or runner processes, and that adapter `userData` replaces the generated script so `spec.env` is not delivered. An empty `env` no longer produces a script.
- da2d15a: `machine.create` rejects a `spec.region` that differs from the adapter `region` before any AWS request. The SDK client is bound to the adapter region, so the spec value was previously neither honored nor rejected and could mislabel the receipt. The receipt `metadata.region` now always reports the adapter region. Create a separate `ec2({ region })` adapter per region.
- 3ef4c9a: `machine.status` now reports EC2 transitional states faithfully: `stopping` maps to `stopping` (was `stopped`) and `shutting-down` maps to `destroying` (was `deleted`), in both the result and the receipt resource. `pending` stays `creating`. An unrecognized or missing native instance state now throws an `AdapterExecutionError` that carries the native value instead of being reported as `failed`. `metadata.awsState` still carries the native state. Callers that treated `stopped` or `deleted` as complete must now wait for those values explicitly.

### Patch Changes

- fc02fac: Deleting an already-absent Neon branch or Cloud Run service is now idempotent success instead of a leaked disposition, matching the Azure adapter; core exports the shared `providerErrorStatus` helper. The Lambda adapter throws `AdapterExecutionError` for missing function names instead of a bare `Error`, and `cloudRun()` accepts zero arguments like its siblings.
- 41120a7: Reuse one lazily created AWS SDK client per adapter instance instead of constructing a new client for every operation. Constructing the adapter still creates no client and resolves no credentials, and an injected `client` is used as is and never replaced. Reuse keeps the SDK keep-alive connection pool and credential cache across operations; no latency improvement is claimed from this change alone.
- c6dbad7: The error-classifying client wrapper now forwards every `send()` argument to the injected or default EC2 client, as the ECS adapter does. Before, only the command was forwarded, so an options argument such as an SDK `abortSignal` never reached the client. The injected client type accepts the options argument.
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
