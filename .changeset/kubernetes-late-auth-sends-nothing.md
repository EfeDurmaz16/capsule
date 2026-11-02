---
"@capsule-sdk/kubernetes": patch
---

A request whose deadline has already passed when `@kubernetes/client-node` finishes authenticating it is now dropped before the HTTP library sees it, so nothing reaches the API server late. The client applies authentication while it builds the request, before the per-request middleware attaches the deadline's signal, and a kubeconfig exec credential plugin (`aws eks get-token`, the GKE auth plugin) that hangs there cannot be cancelled: its process may outlive `operationDeadlineMs` or the log capture `bounds.deadlineMs`. Capsule stops waiting at the deadline as before; this SDK limit is now documented on the adapter options and in the provider quickstart.
