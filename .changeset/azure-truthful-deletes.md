---
"@capsule-sdk/azure": minor
---

Truthful ARM deletes and bounded HTTP for the Azure Container Apps adapter.

- `service.delete` treats ARM 202 as accepted, not deleted. It polls Azure-AsyncOperation or Location (same ARM origin only) or reads the resource until 404, within `operationDeadlineMs` (default 300000), and throws `PendingOperationError` when the deadline expires or an error when the operation ended Failed or Canceled.
- Generated-job cleanup after a failed start uses the same observation; a pending cleanup throws `PartialEffectsError` and a failed one `CleanupFailureError`, both with a `PartialEffects` record.
- Full ARM ids must be in the configured subscription and resource group; they are no longer trimmed to a name and re-addressed.
- `healthcheck` is rejected and `service.healthcheck` is declared `unsupported`, because the template writes no probes.
- Requests check status before parsing JSON, read bounded bodies (`maxResponseBytes`), and time out after `requestTimeoutMs`. A timed-out mutation is `UnknownOutcomeError`. The client exposes `send()` with status and polling headers.
