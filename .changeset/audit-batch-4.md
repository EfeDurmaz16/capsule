---
"@capsule-sdk/core": minor
"@capsule-sdk/cli": patch
---

Concurrent sandbox sub-operations no longer silently drop receipts: adapter emission is tracked per operation instead of being inferred from the shared receipts array length. The default redaction profile now covers everything the receipt verifier flags (AWS access key ids, postgres connection URLs, password= fragments) from one shared credential pattern, and receipt command, source, and cwd fields are redacted at creation as defense in depth. The CLI preview cleanup file gained its own format identifier, capsule.cli.preview-cleanup-file.v1, while still accepting files written with the previous shared string.
