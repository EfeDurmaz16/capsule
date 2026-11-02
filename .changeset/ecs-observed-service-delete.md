---
"@capsule-sdk/ecs": minor
---

`service.delete` no longer reports a service as `deleted` when ECS has only accepted the deletion. ECS answers DeleteService with `DRAINING` while tasks are still stopping, so the adapter now observes DescribeServices until the service is `INACTIVE`, reported `MISSING` or `ServiceNotFoundException`, and only then resolves with `status: "deleted"` and a receipt. If the bounded observation expires it throws `PendingOperationError` (`CAPSULE_OPERATION_PENDING`) with the last native status and a safe service locator, and writes no deleted receipt. The bound is configurable with the new `deleteObservation: { deadlineMs, intervalMs }` adapter option (defaults 600000 ms and 5000 ms). Result and receipt metadata gain `deletion: { acknowledgedStatus, observedTerminal, observations }`.

The best-effort cleanup after a failed `service.deploy` now records `status: "pending"` with `providerStatus` when DeleteService answered `DRAINING`, instead of `deleted`; it reports `deleted` only for an `INACTIVE` response.
