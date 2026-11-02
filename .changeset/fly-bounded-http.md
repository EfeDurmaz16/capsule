---
"@capsule-sdk/fly": minor
---

The Fly client checks the HTTP status before parsing, so an HTML or text error page (for example a 503 maintenance page) now raises the typed provider error with its status and `Retry-After` instead of a `SyntaxError`. Error bodies are read up to 64 KiB and are never echoed raw. Successful bodies are read incrementally up to `maxResponseBytes` (default 16 MiB, `CaptureLimitError` beyond it) and every request has a client deadline `requestTimeoutMs` (default 60000 ms) that also cancels a stalled body. A timed-out GET is a retryable provider error; a timed-out mutation is an `UnknownOutcomeError` because the provider may already have applied it. A malformed successful body is an `AdapterExecutionError`.
