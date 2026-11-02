# @capsule-sdk/store-jsonl

## 0.2.0

### Minor Changes

- f2e11e9: `JsonlReceiptStore` gains `iterate()`, an async iterator that reads receipts one line at a time: only one 1 MiB read chunk, the current line and the receipt being yielded stay in memory, and breaking out of the loop closes the file. `readAll()` now collects the same reader, in 4 MiB chunks, instead of reading and splitting the whole file, so it no longer holds the file text next to the parsed receipts, with the same order, blank-line handling, missing-file result and `path:line` corruption errors. Both read a regular file up to its size when the read started, as `readFile` did, and no longer fail on files larger than the maximum string length. New `maxLineBytes` option (store or per read, default 16 MiB, exported as `DEFAULT_MAX_JSONL_LINE_BYTES`): a longer line fails with its line number. `capsule receipt verify` verifies receipts as they stream and `receipt inspect --id` keeps only the matching receipts; their output is unchanged, and a corrupt line part-way still reports the store unreadable with no partial results.

### Patch Changes

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
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
- 68b5121: Add explicit best-effort and required receipt persistence modes and flush JSONL receipt writes by default.
- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
