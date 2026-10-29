---
"@capsule-sdk/core": patch
---

Sandbox operations no longer share required receipt-write waits. Under `receiptPersistence: "required"`, each sandbox operation awaits only the receipt writes it emitted, so a slow or failing write for one operation no longer delays or rejects a concurrent sibling. The facade also stops keeping every emitted receipt and completed write promise alive for the lifetime of a sandbox handle; receipt history is now held only by the configured receipt store.
