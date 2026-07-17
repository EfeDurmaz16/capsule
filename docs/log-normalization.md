# Log Normalization

Capsule normalizes provider log output into a single `LogEntry` shape so agents, CI, and receipts read the same structure regardless of provider:

```ts
interface LogEntry {
  timestamp: string; // ISO-8601 when the provider supplies one, otherwise a read-time fallback
  stream: "stdout" | "stderr" | "system";
  message: string;
  source?: string; // instance attribution (pod name, container id) when multiple instances share one stream
}
```

Logs are observational. Every `LogEntry[]` Capsule returns is a best-effort bounded snapshot of what the adapter could read at that moment, not a complete or guaranteed transcript of the run. This follows the same rule as receipts (see [ADR 0004](adr/0004-observational-receipts.md)): Capsule reports what it requested, observed, and normalized, not absolute provider truth. Providers sample, rotate, retain for a bounded window, and page their logs; a caller that needs a full audit trail must use provider-native logging.

## Pagination

`JobLogsSpec`, `ServiceLogsSpec`, `EdgeLogsSpec`, and `PreviewLogsSpec` accept an optional `cursor?: string`. When a provider exposes a paged log API, the matching result returns an opaque `nextCursor?: string`; pass it back as `spec.cursor` to fetch the next page. `nextCursor` is absent when there are no more pages, and adapters without a paged log API simply never return it. Cursors are opaque provider tokens; do not parse or construct them.

## Follow mode

`follow` is rejected, not silently ignored, on the bounded-read adapters (Cloud Run, Kubernetes, Vercel). Streaming/tail semantics require a persistent connection that Capsule's bounded read model does not expose yet. Call `logs` again to pick up newer entries.

## Redaction

When policy enables secret redaction, `message` values pass through `redactSecrets`/`redactLogEntries` (core) or an adapter-local equivalent before returning. Cloud Run redacts configured `logRedactionEnv`, Kubernetes redacts literal env values found on the selected pod specs, and Vercel redacts secret-shaped `providerOptions` values. Redaction only rewrites `message`; `timestamp`, `stream`, and `source` are untouched.

## Per-provider mapping

### Cloud Run (`job.logs`, `service.logs`: native)

Read through the Cloud Logging `entries:list` API, not the Cloud Run Admin API (which does not return stdout/stderr).

- `timestamp`: entry `timestamp`, falling back to `receiveTimestamp`, then the epoch.
- `stream`: derived from `logName` (`.../stdout` -> `stdout`, `.../stderr` -> `stderr`, otherwise `system`).
- `message`: `textPayload` when present, otherwise `jsonPayload`/`protoPayload` stringified.
- Bounds: `spec.limit` maps to `pageSize`, `spec.since`/`spec.until` to a `timestamp>=`/`timestamp<=` filter, ordered `timestamp desc`. `spec.cursor` maps to `pageToken`; `nextCursor` is the response `nextPageToken`.
- `source`: not populated (Cloud Logging entries carry their own resource labels rather than a single instance name).

### Kubernetes (`job.logs`, `service.logs`: native)

Logs are collected from the Pods matched by the Job or Service selector via `readNamespacedPodLog` with `timestamps: true`, then combined.

- `timestamp`: parsed from the leading RFC3339 timestamp Kubernetes prepends per line; a read-time fallback is used for any line without a parseable timestamp.
- `stream`: `stdout`. Kubernetes combined pod logs do not split streams without alpha parameters Capsule does not use, so stderr lines also normalize to `stdout`.
- `message`: the line text after the timestamp.
- `source`: the pod name, so lines from a multi-pod Job or Service stay attributable after they are combined.
- Bounds: `spec.limit` maps to `tailLines` per pod and a final tail over the combined set, `spec.since` to `sinceSeconds`, `spec.until` filters client-side. Pagination rides the pod list `continue` token: `spec.cursor` is passed as `_continue` to `listNamespacedPod` and `nextCursor` is the pod list's returned `continue` token. Each pod's log read is itself always a bounded tail, never a full transcript.

### Vercel (`edge.logs`: native)

Two sources, selected by `providerOptions`: deployment build events (default) or runtime logs (`api: "runtime"` / `runtimeLogs: true`, which requires a project id).

- Deployment events: `timestamp` from the event `created`/`date`; `stream` from the event `type` (`stdout`/`stderr`/`fatal`/`error`), otherwise from the response status code (`>= 400` -> `stderr`, else `system`); `message` from the event payload text.
- Runtime logs: `timestamp` from `timestampInMs`; `stream` is `stderr` when `level === "error"`, otherwise `stdout`; `message` from the log message (falling back to source).
- `source`: not populated.

### Docker (`sandbox.exec` result logs)

Docker's `job.logs`/`service.logs` streaming capability is `unsupported`. What Docker does normalize is the `logs` on a `sandbox.exec` (and `job.run`) result, built from captured stdout/stderr by the core `logsFromOutput` helper.

- `timestamp`: a single read-time timestamp for the whole captured output (Docker exec capture is not per-line timestamped here).
- `stream`: `stdout` and `stderr` split by which pipe the text came from.
- `message`: one entry per non-empty line.
- `source`: the container id on `sandbox.exec`, so exec output stays attributable to its container. `job.run` uses `docker run --rm` and does not capture a stable container id, so its result logs carry no `source`.

### Cloudflare (`edge.logs`: unsupported)

Cloudflare edge logs are intentionally left `unsupported`. The honest reasons:

- The live Worker tail API (`GET .../scripts/{name}/tails`) is a WebSocket stream. Capsule's log model is a bounded fetch, and consuming a WebSocket tail would add a dependency and a streaming lifecycle Capsule does not expose.
- A non-WebSocket bounded read does exist: the Workers Observability telemetry query API (`POST .../accounts/{account_id}/workers/observability/telemetry/query`) is a plain HTTP POST. But it is opt-in per Worker (observability defaults off), sampled under load, retained only a few days, and its per-event body schema is handler-dependent and unversioned.
- Normalizing that event body into `LogEntry` without a live account to confirm which fields hold the message, timestamp, and level would fake a support level. Per the honesty rule (do not claim support Capsule cannot back), edge logs stay `unsupported` until the telemetry event shape is pinned against a real account, at which point a bounded, `experimental`-level `edge.logs` reading recent invocation events becomes the natural next step.

The same reasoning is recorded as a comment on the `edge.logs` line in `packages/cloudflare/src/cloudflare-adapter.ts`.

### Other adapters

Adapters that declare their log capabilities `unsupported` (Azure Container Apps, Daytona, E2B, EC2, ECS, Fly, Lambda, Modal, Neon) do not implement provider log reads and never return `nextCursor`. Sandbox-style adapters still populate `LogEntry[]` on exec/run results from captured stdout/stderr via `logsFromOutput`; that path is subject to the same observational, best-effort snapshot rule.
