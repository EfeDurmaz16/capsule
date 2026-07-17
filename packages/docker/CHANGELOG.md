# @capsule-sdk/docker

## 0.1.2

### Patch Changes

- e1f022d: Add the artifact evidence surface. `verifyArtifactHash(artifact, content)` recomputes a file's sha256 and reports a structured result, treating a missing claimed hash as unverifiable rather than trusted. `createArtifactManifest(artifacts)` produces a versioned `capsule.artifact.manifest.v1` manifest whose sha256 digest is taken over the canonical (key-sorted, undefined-dropped) payload, with `verifyArtifactManifest` for tamper detection; the digest is stable under key order and covers `createdAt` and every entry. `collectFileArtifacts(dir, options?)` walks a directory with `node:fs`, hashes each regular file into an `Artifact`, never follows symlinks, emits deterministic sorted output, and bounds the walk with `maxFiles` (default 1000) and `maxBytes` (default 64 MiB), returning explicit truncation info. `ExecSpec` gains an optional `artifactPaths?: string[]`. The Docker adapter now honors it: `sandbox.exec` copies the requested container paths out with `docker cp` and hashes them via the collector, returning them on `ExecResult.artifacts` and the receipt's `artifactHashes`. `job.run` still returns no artifacts because `docker run --rm` removes the container before collection; this stays documented in the capability map and docs/artifacts.md.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 78f0b9a: Add optional log cursor pagination and log source attribution to the core log surface. `JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` gain an optional `cursor`, their results gain an optional `nextCursor`, and `LogEntry` gains an optional `source` for instance attribution. Both additions are optional and backward compatible.

  Cloud Run wires the cursor through Cloud Logging `pageToken`/`nextPageToken`. Kubernetes wires it through the pod list `continue` token and tags each combined log line with its source pod name. Docker tags `sandbox.exec` result logs with the container id. Cloudflare edge logs stay `unsupported` with a documented rationale (live tail is WebSocket-only; the bounded telemetry query API is opt-in and its event schema is unversioned). New `docs/log-normalization.md` consolidates the per-provider mapping and states that captured logs are best-effort bounded snapshots, not complete transcripts.

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

- 7967896: Add explicit job, service, and edge log collection contracts with honest provider support declarations.
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
