---
"@capsule-sdk/core": patch
---

Adapter-side `context.evaluatePolicy()` calls made during a sandbox exec, file or destroy operation now evaluate against that operation's capability path. Previously they had no capability path, so any capability-scoped approval grant, including a fresh per-operation grant, was rejected inside the adapter even though the facade had accepted it.
