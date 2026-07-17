---
"@capsule-sdk/core": minor
"@capsule-sdk/adapter-cloud-run": patch
"@capsule-sdk/adapter-kubernetes": patch
"@capsule-sdk/adapter-docker": patch
"@capsule-sdk/adapter-cloudflare": patch
---

Add optional log cursor pagination and log source attribution to the core log surface. `JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` gain an optional `cursor`, their results gain an optional `nextCursor`, and `LogEntry` gains an optional `source` for instance attribution. Both additions are optional and backward compatible.

Cloud Run wires the cursor through Cloud Logging `pageToken`/`nextPageToken`. Kubernetes wires it through the pod list `continue` token and tags each combined log line with its source pod name. Docker tags `sandbox.exec` result logs with the container id. Cloudflare edge logs stay `unsupported` with a documented rationale (live tail is WebSocket-only; the bounded telemetry query API is opt-in and its event schema is unversioned). New `docs/log-normalization.md` consolidates the per-provider mapping and states that captured logs are best-effort bounded snapshots, not complete transcripts.
