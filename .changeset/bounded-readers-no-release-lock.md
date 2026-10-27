---
"@capsule-sdk/core": patch
"@capsule-sdk/vercel": patch
"@capsule-sdk/cloudflare": patch
"@capsule-sdk/fly": patch
"@capsule-sdk/neon": patch
---

Bounded body readers (`readBoundedText`, the Cloudflare, Fly, Neon and Vercel HTTP clients and the Vercel runtime log reader) no longer call `releaseLock()` on a body they finished, cancelled or saw fail. In Node, `releaseLock()` builds an error whose first use creates a `vm` context, about 1 ms on the first request of a process. The body stays locked, which only matters to code that tried to read a body the client already consumed. Results and caps are unchanged.
