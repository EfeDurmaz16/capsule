---
"@capsule-sdk/kubernetes": patch
---

`service.logs` and `job.logs` now read the Service or Job that names the pod selector under `bounds.deadlineMs` and its AbortSignal. That read ran before the capture deadline started and had no signal, so an API server that never answered left the call pending forever. It now ends at the deadline with no logs, `truncation.reason: "deadline"` (or `CaptureLimitError` with `overflow: "error"`) and `nextCursor` set to the cursor of the page that was not read, and the GET is cancelled. Follow, limit, since and until are now validated before the read, so invalid input makes no request.
