---
"@capsule-sdk/vercel": patch
---

Runtime log reads count record and pending-line sizes with `Buffer.byteLength` instead of encoding a copy, and no longer encode a whole array line whose size is not used. Byte caps and results are unchanged.
