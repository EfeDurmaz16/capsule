---
"@capsule-sdk/cloud-run": minor
---

Truthful long-running operations and bounded HTTP for the Cloud Run adapter.

- `service.delete` reports `deleted` only for a done delete operation, observing it with repeated `operations.wait` calls inside `operationDeadlineMs`; otherwise it throws `PendingOperationError`. With `waitForOperations: false` a delete that is not done is pending, not deleted.
- `job.run` always observes job creation and never calls `:run` after a failed or unfinished create. The returned id is the real Execution from the run operation response or metadata; when none is reported yet it throws `PendingOperationError` with the run operation name instead of returning the Job name.
- `job.cancel` keeps the Execution id (cancel returns an Operation) and reports `cancelled` only when the done operation shows it.
- `healthcheck.command` is rejected on deploy and update instead of replacing the container entrypoint.
- Full resource names must match the configured project (or the new `projectNumber`) and location; short ids must be one path segment.
- Requests check status before parsing JSON, read bounded bodies (`maxResponseBytes`), and time out after `requestTimeoutMs`. A timed-out mutation is `UnknownOutcomeError`.
- The adapter reuses one client and Google auth client; tokens still refresh per request through the auth library.
