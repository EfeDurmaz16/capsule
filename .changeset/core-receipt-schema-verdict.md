---
"@capsule-sdk/core": patch
---

`verifyReceipt` now derives its schema verdict from the exported `capsuleReceiptJsonSchema`, so the runtime check agrees with the published schema. Receipts with an unknown `schemaVersion`, wrongly typed optional members (for example a string `resource` or a non-string `command` element), unknown top-level or nested properties, or invalid policy `enforcement`, `trace`, `cost`, `ttl` or `network` entries are now reported as schema-invalid. Receipts that omit `schemaVersion` remain valid. Some schema error messages are worded differently.
