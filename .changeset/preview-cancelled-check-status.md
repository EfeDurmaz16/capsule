---
"@capsule-sdk/preview": patch
---

`aggregatePreviewStatus` treats a `cancelled` (or `canceled`) resource as failed, so a cancelled check job can no longer make a preview `ready`. Running services remain ready-eligible; running jobs and unknown statuses keep their existing behavior, which is now documented.
