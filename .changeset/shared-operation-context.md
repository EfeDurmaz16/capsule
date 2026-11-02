---
"@capsule-sdk/core": patch
---

Capsule instances now share one AsyncLocalStorage for operation context instead of creating one each. Each instance still sees only its own innermost operation. On Node 22 an AsyncLocalStorage is never released once used, and every one is visited whenever an async resource is created, so a process that created many Capsule instances (for example one per request) slowed down in proportion to how many it had ever created. Measured on a bridge worker that builds one Capsule per request: 2000 requests took 5.3 s before and 0.09 s after, and 8000 requests stay flat at about 0.04 ms each.
