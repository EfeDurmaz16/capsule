---
"@capsule-sdk/kubernetes": patch
---

A log capture whose pod list was read in time but whose pod log reads miss `bounds.deadlineMs` now returns the cursor of that same page: the `cursor` the call was given, or the first-page cursor. Before, it returned the next page's continue token (the pods not read were skipped for good) or, on the last page, no cursor at all (the deadline read as the end of paging). `truncation.reason` is `"deadline"` as before; the next call reads the whole page again.
