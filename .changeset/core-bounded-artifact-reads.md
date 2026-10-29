---
"@capsule-sdk/core": patch
---

`collectFileArtifacts` checks each opened file's size against the remaining `maxBytes` budget before reading any content, hashes through a fixed 64 KiB buffer, and stops reading if a file grows past the budget after that check. An oversized file is no longer read into memory just to be skipped. Inventory, hashes and the whole-file-or-skip truncation semantics are unchanged. This is not a guarantee against a hostile tree that is mutated during collection.
