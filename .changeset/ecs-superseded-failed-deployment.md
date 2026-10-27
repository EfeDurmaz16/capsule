---
"@capsule-sdk/ecs": patch
---

`service.status` no longer reports `failed` only because an older deployment still shows `rolloutState: FAILED` after a newer deployment superseded it. When DescribeServices lists a FAILED deployment next to a PRIMARY deployment that did not fail, the adapter reads the service deployment named by `currentServiceDeployment` with `DescribeServiceDeployments`: a circuit-breaker or alarm rollback (`ROLLBACK_*`), a stop (`STOP_REQUESTED`, `STOPPED`) or an unknown state keeps `failed`; a newer deployment that is `PENDING`, `IN_PROGRESS` or `SUCCESSFUL` reports its own progress (`deploying` or `ready`). Without `currentServiceDeployment`, or when that read fails (for example without the `ecs:DescribeServiceDeployments` permission), the status stays `failed` as before and the reason is in `metadata.serviceDeployment`. Status metadata now also carries `currentServiceDeployment`. The second read happens only for that ambiguous shape.
