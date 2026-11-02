---
"@capsule-sdk/ai": minor
---

`createCodeExecutionTool` no longer lets a sandbox destroy failure overwrite the execution outcome. When execution completed and only destroy failed, `execute` resolves with the completed result plus a `cleanup` report (`status: "failed"`, a safe `residual` locator for the sandbox that may still exist, and the teardown error message), so framework wrappers never turn a finished command into a tool error that invites running it again. When execution failed and destroy failed too, it throws `CleanupFailureError` whose `effects` record (read with `partialEffectsOf`) keeps the primary execution error separately from the cleanup error, with the sandbox locator; its `cause` is the primary execution error. Execution failures with a successful destroy are rethrown unchanged. The new `CodeExecutionResult` and `CodeExecutionCleanupReport` types are exported and used by the wrapper descriptors.
