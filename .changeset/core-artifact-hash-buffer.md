---
"@capsule-sdk/core": patch
---

`collectFileArtifacts` hashes every file of one walk through a single read buffer and treats a short read as the end of the file once the bytes read reach the file's nonzero size, so a small file takes one read again while a file system that returns short reads before the end (FUSE, NFS, SMB) is still hashed whole. Sizes, hashes, budgets and truncation are unchanged.
