---
"@capsule-sdk/docker": minor
---

`runDocker` takes an optional `detached`. With it, the local docker CLI starts as the leader of a process group and session of its own, so a signal sent to the caller's process group does not reach a client whose end could abort the daemon's work. The caller still waits for it, and a timeout or an abort still ends it. Without the option nothing changes.
