---
"@capsule-sdk/kubernetes": patch
---

The `service.delete` observation now hands its deadline signal to every Deployment and Service GET it makes. The installed `@kubernetes/client-node` takes no signal argument, so the adapter passes per-request options whose middleware sets the request's AbortSignal, appended after the middleware the client was built with. When `operationDeadlineMs` expires, the GET still in flight is cancelled instead of left running in the background, and the call still ends with `PendingOperationError`. Injected clients receive the options as a second argument; one that ignores them is abandoned at the deadline, as before.
