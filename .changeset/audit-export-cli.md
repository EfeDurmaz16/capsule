---
"@capsule-sdk/cli": minor
---

Add `capsule audit export --receipt-file <file> [--since <time>] [--until <time>]`: streams one JSON line per stored receipt and one per its policy decision, for receipts that started in `[since, until)`, for a log or SIEM pipeline. Bounds are ISO 8601 dates or times (a date alone is midnight UTC); anything else is a usage error. With a bound, a receipt whose `startedAt` is not a time is left out and named on stderr instead of dropped silently.
