---
"@capsule-sdk/ai": minor
---

`createCodeExecutionTool` no longer lets a sandbox destroy failure overwrite the execution outcome. When destroy fails it throws `CleanupFailureError` whose `effects` record (read with `partialEffectsOf`) keeps the completed `ExecResult` or the primary execution error separately from the cleanup error, plus a safe locator for the sandbox that may still exist. The error `cause` is the primary execution error when execution failed, otherwise the cleanup error. Execution failures with a successful destroy are rethrown unchanged.
