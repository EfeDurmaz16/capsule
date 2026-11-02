---
"@capsule-sdk/docker": minor
---

`runDocker` takes an optional `signal`. Aborting it kills the local docker CLI with SIGKILL and rejects with the signal's `AbortError`; like a timeout, it stops only the client, never a container or an exec'd process in the daemon. Without a signal nothing changes.
