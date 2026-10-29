---
"@capsule-sdk/core": patch
---

`redactError` now also redacts an `Error.stack` string that was materialized before redaction, on the error and on nested `cause` errors. Previously the stack kept the original first line, so logging a thrown error could print a credential that the redacted `message` no longer showed. The error keeps its class, identity and stack frames, and cyclic `cause` chains no longer recurse forever.
