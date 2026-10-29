---
"@capsule-sdk/store-sqlite": patch
---

`SqliteReceiptStore` prepares its `INSERT OR REPLACE` and `readAll` statements once per store and reuses them instead of preparing them on every call. Writes are still one autocommitted statement each, with the same ordering, replacement and closed-store errors; a write SQLite rejects leaves the store usable.
