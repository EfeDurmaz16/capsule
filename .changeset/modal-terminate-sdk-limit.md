---
"@capsule-sdk/modal": patch
---

Documents a limit of the installed modal SDK on `terminateDeadlineMs`. `Sandbox.terminate`, `wait` and `poll` accept no AbortSignal or timeout, so at the deadline Capsule stops waiting and throws `PendingOperationError`, but the SDK call keeps polling Modal in the background until the sandbox exits. Its late result is ignored: no receipt is written and a create rollback stays reported as pending. Because the SDK sends the terminate request and waits in one call, a pending termination at the deadline does not prove Modal accepted the request. Behavior is unchanged.
