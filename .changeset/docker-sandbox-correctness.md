---
"@capsule-sdk/docker": minor
---

Docker sandbox correctness fixes.

- `listFiles(path)` no longer runs through a shell. The path is passed to `find` as one argument, so `$()`, backticks, quotes and newlines stay literal, and entries are parsed from NUL-separated fields so names with tabs or newlines round-trip. A path starting with `-`, `(` or `!` is anchored with `./`.
