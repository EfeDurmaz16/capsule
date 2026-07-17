# @capsule-sdk/azure

## 0.1.2

### Patch Changes

- b14410b: Credential-shaped tokens (Bearer values, provider key prefixes, JWTs) are now redacted from Capsule-observed logs, receipts, and errors on every redaction profile, not only under `redactionProfile: "strict"`; matching is case-insensitive to stay consistent with `verifyReceipt`. The strict profile still adds the broad long-token catch-all. `capsule doctor` now reports Node versions below 22 as unsupported, matching the declared engines floor. The Azure Container Apps adapter reads HTTP status from the provider error classification as a fallback when detecting missing jobs.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 951af73: Adopt the provider error taxonomy across every adapter. Core adds `classifySdkError`, `asProviderError`, and `callProvider` so SDK-based adapters normalize provider error shapes (status codes, error names/codes) into the shared retryable/rate-limit/auth/validation categories. The docker, kubernetes, lambda, ec2, ecs, e2b, daytona, modal, and mock adapters now attach `cause.providerError` on failures instead of throwing raw errors, so callers get the same typed categories the six HTTP adapters already emitted. Docker classifies conservatively from CLI exit codes and stderr signals. Each adapter contract test now exercises the shared failure-scenario harness with a real scenario, and the Azure Container Apps client gains explicit classification tests.
- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [a0d12be]
- Updated dependencies [b14410b]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [951af73]
- Updated dependencies [f78c06f]
  - @capsule-sdk/core@0.2.0

## 0.1.1

### Patch Changes

- 5e2062e: Add Azure Container Apps job status, job cancellation, service status, and service deletion support.
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
