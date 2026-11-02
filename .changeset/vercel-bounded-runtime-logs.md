---
"@capsule-sdk/vercel": minor
---

Runtime logs (`providerOptions.api: "runtime"`) are now read incrementally from the live runtime logs stream with the documented `format=lines` framing. The read stops at the record cap (`limit`, or `bounds.maxRecords`), the byte cap (`bounds.maxBytes`) or the deadline (`bounds.deadlineMs`, default 60000 ms), cancels the body, and reports `truncation` on the result. Records split across chunks are reassembled, malformed lines are skipped and counted in `metadata.malformedRecords`, and Vercel's runtime-limit delimiter ends the read. Previously the adapter waited for the stream to close and buffered everything.

Runtime logs now reject `since` and `until`, because the endpoint has no history query; before, they were silently ignored. Receipt metadata records which constraints were applied and by whom (`appliedConstraints`).

`VercelClient.readRuntimeLogs()` is new and returns records, truncation and malformed-record counts; `getRuntimeLogs()` uses it and returns the records only.

The client also checks the HTTP status before parsing, so an HTML or text error page keeps its status, `Retry-After` and typed retry category. Error bodies are read up to 64 KiB and never echoed raw; successful bodies are bounded by `maxResponseBytes` (default 16 MiB) and each request by `requestTimeoutMs` (default 60000 ms). A timed-out mutation raises `UnknownOutcomeError`.
