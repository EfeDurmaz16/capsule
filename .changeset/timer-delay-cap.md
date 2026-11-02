---
"@capsule-sdk/core": patch
"@capsule-sdk/vercel": patch
"@capsule-sdk/cloudflare": patch
"@capsule-sdk/fly": patch
"@capsule-sdk/neon": patch
---

A capture deadline, observation deadline or interval, or HTTP `requestTimeoutMs` of 2^31 ms (about 24.8 days) or more no longer expires after 1 ms. Node fires a longer `setTimeout` after 1 ms; these timers now wait the largest delay Node supports instead.
