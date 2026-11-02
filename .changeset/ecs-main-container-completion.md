---
"@capsule-sdk/ecs": minor
---

`job.status` decides the outcome of a STOPPED task from the configured `containerName` only, the container Capsule overrides with the job command. Exit code 0 is `succeeded`; any other exit code, or a missing main container or exit code, is `failed`. Previously any nonzero container failed the job and any zero exit code from a helper could mark a never-started main container as `succeeded`. `UserInitiated` stops are still `cancelled`. Status, cancel and receipt metadata now include `containers` (name, lastStatus, exitCode, reason) and `completionContainer` alongside the raw `stopCode` and `stoppedReason`.
