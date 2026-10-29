---
"@capsule-sdk/cloudflare": minor
---

When a route fails after the Worker upload in `edge.deploy`, the error now reports every effect instead of only the route error. If removing the routes created by the call fails, it throws `CleanupFailureError`; otherwise it throws `PartialEffectsError`. In both cases `cause` is the original route error and `partialEffectsOf(error)` returns the uploaded Worker, the created routes, the cleanup outcome and the residual resources. The uploaded Worker is still not deleted, because the upload may have replaced an existing Worker. Callers that matched the route error class directly should read `error.cause` instead.
