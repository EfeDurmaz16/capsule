---
"@capsule-sdk/e2b": minor
---

Report E2B command outcomes truthfully and keep the sandbox alive.

- A nonzero exit reported by the installed SDK as `CommandExitError` is now a normal `ExecResult` with the exit code, stdout, stderr and a `sandbox.exec` receipt. The sandbox is no longer killed when a command such as `npm test` fails.
- Other exec failures no longer kill the sandbox. A refused request (auth, validation, rate limit) still rejects with the typed provider error. Any other failure (timeout, dropped connection, unknown server error) rejects with `UnknownOutcomeError` (`retrySafe: false`), because the command may already have run; the provider error is its `cause`.
- `sandbox.artifacts`, `sandbox.streamingLogs` and `sandbox.exposePort` are now declared `unsupported`. The adapter never collected `ExecSpec.artifactPaths` (always `[]`), has no streaming API and ignores `exposedPorts`, so the previous `emulated`/`experimental` levels promised behavior Capsule cannot invoke.
- `exec({ input })` now rejects with `UnsupportedCapabilityError` (`sandbox.exec.input`) before any provider call instead of silently dropping the input. The installed SDK has no public way to close a command's stdin, so EOF cannot be delivered.
