---
"@capsule-sdk/kubernetes": patch
---

`service.logs` and `job.logs` now bound the pod list with `bounds.deadlineMs` and cancel the requests still in flight. The pod list was awaited with no deadline, so a slow or hung list was not bounded at all; it now ends at the deadline with no logs, `truncation.reason: "deadline"` and `nextCursor` set to the cursor of the page that was not read. Pod log reads still in flight at the deadline, or when another read fails the capture, are cancelled through the same per-request AbortSignal middleware instead of left open after the call returns.
