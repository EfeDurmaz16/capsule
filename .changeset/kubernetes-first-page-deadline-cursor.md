---
"@capsule-sdk/kubernetes": patch
---

A log capture whose first page (no `cursor`) misses `bounds.deadlineMs` before the Service or Job selector or the pod list was read now returns a `nextCursor` that reads the first page again. Before, it returned no cursor, which `JobLogsResult` defines as "no more pages", so a pager stopped after reading zero pods. Cursors stay opaque: a continue token from the API server is handed back unchanged, and cursors from earlier versions keep working. The reverse does not hold: the first-page cursor is new, and an earlier `@capsule-sdk/kubernetes` would send it to the API server as a continue token, so a persisted cursor must only be passed back to the version that issued it or a newer one.
