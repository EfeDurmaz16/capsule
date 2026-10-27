---
"@capsule-sdk/ec2": minor
"@capsule-sdk/ecs": minor
---

Caller `idempotencyKey` values now reach the native AWS idempotency parameter where one exists, in addition to the existing `capsule_operation_*` correlation tags. EC2 `machine.create` sends a RunInstances `ClientToken` scoped to the adapter region. ECS `job.run` sends a RunTask `clientToken` scoped to the adapter region and cluster. Each token is a 32-character hex hash, so the raw key never reaches AWS. AWS then deduplicates retries of the same request within its token window. Reusing a key with different parameters fails with the provider error (`IdempotentParameterMismatch` on EC2, `ConflictException` on ECS) instead of creating a second resource. This is provider retry deduplication, not an exactly-once guarantee, and receipts say so. ECS `service.deploy` still uses the key only as a correlation tag; service names are already unique per cluster.
