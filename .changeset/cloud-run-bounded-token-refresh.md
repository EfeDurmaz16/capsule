---
"@capsule-sdk/cloud-run": patch
---

Obtaining the Application Default Credentials token is now bounded by the request it serves. `google-auth-library`'s `getRequestHeaders` takes no AbortSignal, so the adapter cannot cancel a token refresh; it now stops waiting for it at `requestTimeoutMs` or at the `operationDeadlineMs` observation deadline, never sends the request, and reports a retryable error (`PendingOperationError` inside an operation observation). Before, a hung refresh outside an observation never ended, and a refresh that finished after the deadline still started the request. The refresh itself may finish later in the background. Configurations with `accessToken` are unaffected.
