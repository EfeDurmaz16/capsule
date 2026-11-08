---
"@capsule-sdk/core": minor
---

Add an optional tracing hook: pass `trace: { tracer }` with any OpenTelemetry API tracer and every operation gets one span with its operation id, job, provider, action, outcome, policy decision and SHA-256 digests of the idempotency key and approval ref; receipts, denials, pending and unknown outcomes are span events. Core takes no dependency, and spans never carry env values, raw approval refs, output, error text, or argv unless asked for on a policy that does not redact logs.
