---
"@capsule-sdk/bridge-worker": minor
---

Add `listResiduals(driver, { live, ended })` to the worker's internal API: the Docker and fixture profiles list what carries the operation label in the bound scope. Only an owner the caller ended and holds no longer live is a residual; an owner it does not name, such as another daemon's job on the same engine, is kept as `unknown`. It changes nothing and is not a v1 message.
