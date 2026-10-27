---
"@capsule-sdk/core": patch
---

`collectFileArtifacts` hashes every file of one walk through a single read buffer and treats a short read as the end of a regular file, so a small file takes one read again. Sizes, hashes, budgets and truncation are unchanged.
