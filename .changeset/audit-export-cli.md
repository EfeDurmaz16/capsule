---
"@capsule-sdk/cli": minor
---

Add `capsule audit export --receipt-file <file> [--since <time>] [--until <time>]`: streams one JSON line per stored receipt and one per its policy decision, for receipts that started in `[since, until)`, for a log or SIEM pipeline. Times are ISO 8601; anything else is a usage error.
