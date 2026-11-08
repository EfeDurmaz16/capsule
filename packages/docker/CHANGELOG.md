# @capsule-sdk/docker

## 0.2.0

### Minor Changes

- 243ad90: Implement `sandbox.attach` for Docker: it inspects the container (a read only) and returns a sandbox handle for that container id, so later exec and destroy go through Capsule policy and receipts. Add a `pull` adapter option passed to `docker create --pull`; `pull: "never"` makes a create fail when the image is not present locally instead of contacting a registry. Without the option the create arguments are unchanged.
- 9384ef9: `sandbox.exec({ bounds: { deadlineMs } })` now bounds the whole command, not only its output capture. When the deadline expires the docker CLI is killed exactly as `timeoutMs` kills it, and exec rejects with `UnknownOutcomeError` carrying the output captured so far and its truncation record, because killing the client does not stop the process inside the container. `timeoutMs` is unchanged and independent: whichever of the two expires first stops the CLI. `job.run` is still bounded by `timeoutMs` alone. `runDocker` accepts `deadlineMs` and marks a result stopped this way with `deadlineExceeded: true` (exit code 124, the note on `timeoutNote`).
- 8d79470: `runDocker` takes an optional `signal`. Aborting it kills the local docker CLI with SIGKILL and rejects with the signal's `AbortError`; like a timeout, it stops only the client, never a container or an exec'd process in the daemon. Without a signal nothing changes.
- b333df7: `runDocker` takes an optional `detached`. With it, the local docker CLI starts as the leader of a process group and session of its own, so a signal sent to the caller's process group does not reach a client whose end could abort the daemon's work. The caller still waits for it, and a timeout or an abort still ends it. Without the option nothing changes.
- 8478955: Docker sandbox correctness fixes.

  - `listFiles(path)` no longer runs through a shell. The path is passed to `find` as one argument, so `$()`, backticks, quotes and newlines stay literal, and entries are parsed from NUL-separated fields so names with tabs or newlines round-trip. A path starting with `-`, `(` or `!` is anchored with `./`.
  - `sandbox.destroy()` now checks the `docker rm -f` exit code. A nonzero exit rejects with the classified provider error and writes no `deleted` receipt. A container that is already absent (`No such container`) resolves and its receipt carries `metadata.alreadyAbsent: true`.
  - `sandbox.create()` removes the container it allocated when `docker start`, receipt signing or another step fails before the handle is returned. A successful rollback rejects with `PartialEffectsError` (cause is the original error, `cleanup.status: "succeeded"`); a failed rollback rejects with `CleanupFailureError` whose `effects` lists the residual container. Read both with `partialEffectsOf(error)`.
  - Sandbox exec artifacts keep their path relative to the deepest directory shared by all requested `artifactPaths`. `/a/out.txt` and `/b/out.txt` are now returned as `a/out.txt` and `b/out.txt` with their own hashes instead of one overwriting the other. A single path, or paths in one directory, keep the previous basename layout. Requesting the same container path twice, or the container root, rejects before the command runs. When one requested path is inside another, each directory on the way to the nested copy's destination is created one at a time and checked, so a symbolic link the container planted (`/out/logs` pointing at a host directory) rejects the exec with `AdapterExecutionError` instead of letting `mkdir -p` or `docker cp` follow it and write on the host.
  - `sandbox.exec({ input })` now passes `-i` to `docker exec` so the input actually reaches the process, and stdin is always closed afterwards so the process sees EOF. Empty input (`""`) attaches stdin and delivers an immediate EOF. Without `input`, stdin is not attached, as before.
  - `job.artifacts` is now declared `unsupported`. `job.run` uses `docker run --rm` and never collected artifacts; `sandbox.artifacts` stays `emulated` because sandbox exec collection is real.
  - Timeouts no longer claim the command stopped. `runDocker` results carry `timedOut: true` when the local CLI was killed. A timed-out `job.run` now finds its container by a per-run label (`capsule_docker_run`, recorded as `metadata.runLabel` on the receipt) and removes it with `docker rm -f`; the receipt records `termination: "removed"` or `"not-created"`. If removal cannot be confirmed, `job.run` rejects with `CleanupFailureError` whose `effects` has `outcome: "unknown"` and the residual container. A timed-out `sandbox.exec` now rejects with `UnknownOutcomeError` instead of returning exit code 124, because the process may still run inside the container. A timed-out `docker create` rejects with `UnknownOutcomeError` naming the container, without removing anything.
  - Exec and job output is now bounded while it is read (CD-BOUNDS). `ExecSpec.bounds.maxBytes` caps each stream (default 16 MiB, with `policy.limits.maxStdoutBytes`/`maxStderrBytes` as ceilings, also applied to `job.run`); bytes past the cap are read and discarded so the command still completes. Results carry `truncation` per stream, and truncated receipts record `metadata.outputTruncation`. `bounds.overflow: "error"` rejects with `CaptureLimitError` after the command exits; when the command times out first, the timeout wins (`sandbox.exec` throws `UnknownOutcomeError`, and `runDocker` resolves `timedOut` with the limit kept on `captureLimit`), because the process may still be running. A capture deadline applies only when `bounds.deadlineMs` is set. When a cut lands inside a redacted secret, the trailing secret prefix is redacted too, also when a timeout note follows the captured output. `runDocker` accepts `outputBounds` and returns `truncation`, and on timeout `timeoutNote` names the note it appended to `stderr`.

- 77f3c8b: List containers that carry the `capsule_operation` label (`residuals.list()`), so `capsule.gc` can find and remove sandboxes a crashed run left behind.

### Patch Changes

- e1f022d: Add the artifact evidence surface. `verifyArtifactHash(artifact, content)` recomputes a file's sha256 and reports a structured result, treating a missing claimed hash as unverifiable rather than trusted. `createArtifactManifest(artifacts)` produces a versioned `capsule.artifact.manifest.v1` manifest whose sha256 digest is taken over the canonical (key-sorted, undefined-dropped) payload, with `verifyArtifactManifest` for tamper detection; the digest is stable under key order and covers `createdAt` and every entry. `collectFileArtifacts(dir, options?)` walks a directory with `node:fs`, hashes each regular file into an `Artifact`, never follows symlinks, emits deterministic sorted output, and bounds the walk with `maxFiles` (default 1000) and `maxBytes` (default 64 MiB), returning explicit truncation info. `ExecSpec` gains an optional `artifactPaths?: string[]`. The Docker adapter now honors it: `sandbox.exec` copies the requested container paths out with `docker cp` and hashes them via the collector, returning them on `ExecResult.artifacts` and the receipt's `artifactHashes`. `job.run` still returns no artifacts because `docker run --rm` removes the container before collection; this stays documented in the capability map and docs/artifacts.md.
- 048a7cf: Sandbox artifact collection copies requested paths that do not lie inside each other with up to four `docker cp` calls at a time instead of one after another. It is still one `docker cp` per path with the same arguments, and the artifact layout, selection and hashes are unchanged. Paths nested inside another requested path, or paths that could name one host path on a case- or Unicode-insensitive file system, are still copied one by one in request order. After a failed copy no further copy starts, running copies finish before the temporary directory is removed, and the error of the earliest failed path is raised, as before.
- 44af187: Captured exec and job output is decoded with a `StringDecoder`, as before output bounds existed, instead of a streaming `TextDecoder`. A leading UTF-8 byte order mark in the output is kept again, and decoding is faster; the byte cap, truncation and redaction are unchanged.
- 0bc3612: The published tarball no longer ships the declarations of the test-only receipt fixture module, and the `runDocker` option and result docs in the declarations are one line each; the full stop semantics (a timeout, deadline or abort kills only the docker CLI, the process in the daemon may keep running) stay in the Docker quickstart and the source. No behaviour change.
- 469b9fe: `sandbox.destroy` now rejects with `UnknownOutcomeError`, carrying the container locator, when `docker rm -f` times out. Killing the CLI does not stop the removal in the daemon, so a timed-out destroy is not a definite failure; before, it rejected with a retryable provider error that callers could read as "nothing happened". Exec and create already reported their timeouts this way.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 78f0b9a: Add optional log cursor pagination and log source attribution to the core log surface. `JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` gain an optional `cursor`, their results gain an optional `nextCursor`, and `LogEntry` gains an optional `source` for instance attribution. Both additions are optional and backward compatible.

  Cloud Run wires the cursor through Cloud Logging `pageToken`/`nextPageToken`. Kubernetes wires it through the pod list `continue` token and tags each combined log line with its source pod name. Docker tags `sandbox.exec` result logs with the container id. Cloudflare edge logs stay `unsupported` with a documented rationale (live tail is WebSocket-only; the bounded telemetry query API is opt-in and its event schema is unversioned). New `docs/log-normalization.md` consolidates the per-provider mapping and states that captured logs are best-effort bounded snapshots, not complete transcripts.

- 9ed60f4: Stop packing declaration files the package's `types` entry never reaches, and declaration maps for core and docker, which pointed at sources the packages do not ship. What a consumer can import is unchanged.
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
