---
"@capsule-sdk/bridge-worker": minor
---

Trace Fabric-driven operations. When the worker process registered an OpenTelemetry SDK (`node --import`), every request gets the Capsule spans of its operation with `fabric.operation.id`, `fabric.job` and `fabric.request.id` attributes and a link to a span context derived from the Fabric operation id (first 48 hex of `sha256("fabric.operation:" + id)`); a `TRACEPARENT` in the environment adds a link to the spawning session. A request refused before any Capsule span started gets a span of its own; an idempotent replay of a stored answer adds none. The worker reads the tracer from the provider the SDK registered, so it imports no OpenTelemetry package and traces wherever it is installed.
