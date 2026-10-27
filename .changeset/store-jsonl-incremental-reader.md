---
"@capsule-sdk/store-jsonl": minor
"@capsule-sdk/cli": patch
---

`JsonlReceiptStore` gains `iterate()`, an async iterator that reads receipts one line at a time: only one 1 MiB read chunk, the current line and the receipt being yielded stay in memory, and breaking out of the loop closes the file. `readAll()` now collects the same reader instead of reading and splitting the whole file, so it no longer holds the file text next to the parsed receipts, with the same order, blank-line handling, missing-file result and `path:line` corruption errors. Both read a regular file up to its size when the read started, as `readFile` did, and no longer fail on files larger than the maximum string length. New `maxLineBytes` option (store or per read, default 16 MiB, exported as `DEFAULT_MAX_JSONL_LINE_BYTES`): a longer line fails with its line number. `capsule receipt verify` verifies receipts as they stream and `receipt inspect --id` keeps only the matching receipts; their output is unchanged, and a corrupt line part-way still reports the store unreadable with no partial results.
