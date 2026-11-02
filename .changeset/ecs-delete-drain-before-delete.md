---
"@capsule-sdk/ecs": minor
---

A non-forced `service.delete` now waits for the scale-to-zero to finish before calling DeleteService. ECS deletes a service without `force` only when it has no running tasks, and the adapter previously sent DeleteService right after the UpdateService acknowledgment while tasks were still running. When the UpdateService response still reports running or pending tasks, the adapter observes DescribeServices until both counts are zero. If they are not zero within the `deleteObservation` budget, it throws `PendingOperationError` and sends no DeleteService. The budget is shared with the INACTIVE observation. `force: true` keeps the documented ECS behavior and deletes without waiting; Capsule never adds `force` on its own.
