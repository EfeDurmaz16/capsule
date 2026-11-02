---
"@capsule-sdk/docker": patch
---

`sandbox.destroy` now rejects with `UnknownOutcomeError`, carrying the container locator, when `docker rm -f` times out. Killing the CLI does not stop the removal in the daemon, so a timed-out destroy is not a definite failure; before, it rejected with a retryable provider error that callers could read as "nothing happened". Exec and create already reported their timeouts this way.
