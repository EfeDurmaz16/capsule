---
"@capsule-sdk/modal": minor
---

Sandbox termination now sends one terminate request and polls until the sandbox has stopped. `sandbox.destroy()` and the `sandbox.create()` rollback call the SDK's `terminate()` once (no wait), then poll a fresh `client.sandboxes.fromId()` handle with `poll()` about once a second until it reports an exit code; each poll is one zero-wait request. The destroy receipt records the `exitCode` and the number of `polls` (the `terminateWait` field is gone).

The installed modal SDK's `terminate`, `poll` and `fromId` take no AbortSignal or timeout, so `terminateDeadlineMs` is enforced between calls: no SDK call starts after the deadline and only the one zero-wait call in flight when it expires outlives it; its late answer is ignored and never writes a receipt. Inside that one call the SDK's own client retries a transient gRPC status up to three times (100, 200 and 400 ms apart), so a few more wire requests can follow the deadline before it settles. At the deadline `destroy()` rejects with `PendingOperationError` when Modal answered the terminate request (the sandbox is stopping) and with `UnknownOutcomeError` when it did not (Modal may or may not have received it). A create rollback reports its cleanup as `pending` or `unknown` in the same cases, and `PartialEffectsError` carries both. A rejected terminate request still rejects with the classified provider error; a failed `fromId` or `poll` after an answered request is reported as pending.

Injected `client` objects must now provide `sandboxes.fromId(sandboxId)` returning a handle with `poll()`, matching the installed SDK.
