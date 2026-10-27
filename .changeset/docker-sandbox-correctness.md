---
"@capsule-sdk/docker": minor
---

Docker sandbox correctness fixes.

- `listFiles(path)` no longer runs through a shell. The path is passed to `find` as one argument, so `$()`, backticks, quotes and newlines stay literal, and entries are parsed from NUL-separated fields so names with tabs or newlines round-trip. A path starting with `-`, `(` or `!` is anchored with `./`.
- `sandbox.destroy()` now checks the `docker rm -f` exit code. A nonzero exit rejects with the classified provider error and writes no `deleted` receipt. A container that is already absent (`No such container`) resolves and its receipt carries `metadata.alreadyAbsent: true`.
- `sandbox.create()` removes the container it allocated when `docker start`, receipt signing or another step fails before the handle is returned. A successful rollback rejects with `PartialEffectsError` (cause is the original error, `cleanup.status: "succeeded"`); a failed rollback rejects with `CleanupFailureError` whose `effects` lists the residual container. Read both with `partialEffectsOf(error)`.
- Sandbox exec artifacts keep their path relative to the deepest directory shared by all requested `artifactPaths`. `/a/out.txt` and `/b/out.txt` are now returned as `a/out.txt` and `b/out.txt` with their own hashes instead of one overwriting the other. A single path, or paths in one directory, keep the previous basename layout. Requesting the same container path twice, or the container root, rejects before the command runs.
