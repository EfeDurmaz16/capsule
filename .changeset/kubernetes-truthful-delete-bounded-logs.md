---
"@capsule-sdk/kubernetes": minor
---

Truthful deletes, bounded logs and stricter validation for the Kubernetes adapter.

- `service.delete` deletes the Deployment and the Service independently (404 per resource means already absent) and reports `deleted` only after both are observed gone. An accepted foreground delete still terminating at `operationDeadlineMs` (default 120000) throws `PendingOperationError`. A partial failure throws `PartialEffectsError` with both locators. Clients used for delete now need `readNamespacedDeployment` and `readNamespacedService`.
- A deploy whose Service step fails reports the Deployment rollback outcome (`PartialEffectsError`, or `CleanupFailureError` when the rollback failed) instead of swallowing it. The original error stays the primary error.
- Job and service logs honor `bounds`: each pod read is a bounded tail with `limitBytes`, at most `bounds.concurrency` reads run at once, and results carry `truncation`. Kubelet applies `limitBytes` forward from the start of the tail, so when a tail does not fit in `bounds.maxBytes` the adapter reads again with a shorter tail until the newest lines fit; every read stays bounded by `maxBytes`. Entries are merged by nanosecond timestamp before `limit`, so the newest entries win regardless of pod order. The Kubernetes log API has no end-time filter, so `until` is applied to the bounded tail: when that tail is full and filters down below the requested size, older matching lines were not read and the result is marked truncated (`reason: "records"`) instead of complete. This is a weaker guarantee than reading the whole log, which the previous unbounded read did. Every literal env value on every selected pod is redacted, not one value per name.
- `job.run` no longer returns a placeholder `result` with exit code 0 for a Job that only started.
- Service ports get unique names (`http-8080`); duplicate or invalid ports, `healthcheck.command`, and `scale.max` different from the replica count are rejected before any request. Names are validated after truncation, Service names must start with a letter, and generated job names include random bits.
- The kubeconfig is parsed and API clients are built once per adapter. Set `reloadKubeconfigPerOperation: true` to reread it for every operation.
