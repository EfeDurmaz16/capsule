---
"@capsule-sdk/ec2": patch
"@capsule-sdk/ecs": patch
"@capsule-sdk/lambda": patch
---

Reuse one lazily created AWS SDK client per adapter instance instead of constructing a new client for every operation. Constructing the adapter still creates no client and resolves no credentials, and an injected `client` is used as is and never replaced. Reuse keeps the SDK keep-alive connection pool and credential cache across operations; no latency improvement is claimed from this change alone.
