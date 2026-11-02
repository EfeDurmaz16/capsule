---
"@capsule-sdk/docker": minor
---

`sandbox.exec({ bounds: { deadlineMs } })` now bounds the whole command, not only its output capture. When the deadline expires the docker CLI is killed exactly as `timeoutMs` kills it, and exec rejects with `UnknownOutcomeError` carrying the output captured so far and its truncation record, because killing the client does not stop the process inside the container. `timeoutMs` is unchanged and independent: whichever of the two expires first stops the CLI. `job.run` is still bounded by `timeoutMs` alone. `runDocker` accepts `deadlineMs` and marks a result stopped this way with `deadlineExceeded: true` (exit code 124, the note on `timeoutNote`).
