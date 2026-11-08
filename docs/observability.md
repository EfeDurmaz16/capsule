# Observability

Capsule sends one OpenTelemetry span per operation to the tracer you give it, and exports receipts and policy decisions as JSONL. Core has no OpenTelemetry dependency: the tracer hook takes any `@opentelemetry/api` tracer, and you bring the SDK and exporter.

## What a span will never carry

- Env values, secret values, stdout, stderr, or error message text. A failed span's status message is the error type name only.
- A raw approval ref or idempotency key. Both appear as SHA-256 digests, so a span joins to its receipt without carrying the value.
- The exec argv. A span records `capsule.command.argc`; the redacted argv is added only with `trace: { argv: true }`, and never when the policy has a `secrets` block that redacts logs or the exec carries env.

## Setup: OpenTelemetry SDK plus OTLP

```sh
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
new NodeSDK({ traceExporter: new OTLPTraceExporter() }).start(); // OTLP over HTTP, http://localhost:4318 by default
```

Then pass a tracer to the Capsule:

```ts
import { trace } from "@opentelemetry/api";
const capsule = new Capsule({ adapter, policy, receipts: true, trace: { tracer: trace.getTracer("capsule") } });
```

A tracer that does not sample (or no `trace` option) leaves results, receipts and policy decisions unchanged. Spans start under the active context, so a span you have open becomes their parent; Capsule does not make its span active, so provider client spans are siblings, not children.

## Bridge worker (Fabric)

`capsule-bridge-worker` traces when the process registered an SDK before it started, and imports nothing otherwise:

```sh
node --import ./otel.mjs node_modules/@capsule-sdk/bridge-worker/dist/bin.js --profile docker
```

where `otel.mjs` holds the three setup lines. `@opentelemetry/api` is an optional peer of the worker; install it next to the worker. The single executable build does not trace.

Each Fabric request gets the Capsule spans of its operation, plus:

- `fabric.operation.id`, `fabric.job` and `fabric.request.id` attributes.
- A link to a span context derived from the Fabric operation id alone: trace id and span id are the first 32 and next 16 hex of `sha256("fabric.operation:" + operation_id)`. Fabric derives the same ids for its side of the operation, so a trace backend joins both without a protocol change.
- A link to the `TRACEPARENT` in the worker's environment (W3C trace context, OpenTelemetry's environment carrier), when Fabric sets one.
- A request the worker refuses before the Capsule facade (scope, owner, image, secret or approval checks) still gets one span, with `capsule.outcome` `denied` or `failed` and `capsule.refusal.reason`. Observe and attach messages only read and are not traced.

## Span attributes

The span name is `capsule <action>`, kind `CLIENT`.

| Attribute                             | Value                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `capsule.operation.id`                | `op_` plus 32 hex, new per operation. A create with an owner labels its resource with this id (`capsule_operation`).                                                                                                                                                                                                                                               |
| `capsule.job`                         | The owner job (`new Capsule({ owner: { job } })`), when set.                                                                                                                                                                                                                                                                                                       |
| `capsule.provider`, `capsule.adapter` | The adapter's provider and name.                                                                                                                                                                                                                                                                                                                                   |
| `capsule.action`                      | The facade method: `sandbox.create`, `sandbox.exec`, `job.run`, `database.branch.create`, `gc.remove`, and so on.                                                                                                                                                                                                                                                  |
| `capsule.outcome`                     | `completed`, `pending`, `denied`, `unsupported`, `unknown` or `failed`. A result whose status is in progress (`queued`, `deploying`, `creating`, `building`, `releasing`, `rolling_back`, `resetting`, `cancelling`, `deleting`, `starting`, `stopping`, `destroying`, or `running` outside `machine.*`) is `pending`; a `failed` or `partial` status is `failed`. |
| `capsule.result.status`               | The status the provider returned, when the result has one.                                                                                                                                                                                                                                                                                                         |
| `capsule.policy.decision`             | `allowed` or `denied`, when the operation evaluated policy.                                                                                                                                                                                                                                                                                                        |
| `capsule.idempotency.key_digest`      | SHA-256 hex of the idempotency key, when given.                                                                                                                                                                                                                                                                                                                    |
| `capsule.approval.ref_digest`         | SHA-256 hex of the approval grant id, when given.                                                                                                                                                                                                                                                                                                                  |
| `capsule.command.argc`                | Number of argv parts of an exec or job.                                                                                                                                                                                                                                                                                                                            |
| `capsule.command.argv`                | Redacted argv, only as described above.                                                                                                                                                                                                                                                                                                                            |
| `capsule.error.type`                  | Error class name, on a span that did not complete.                                                                                                                                                                                                                                                                                                                 |
| `capsule.refusal.reason`              | Bridge worker refusal reason, for example `approval_required`.                                                                                                                                                                                                                                                                                                     |

| Event                     | When                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `capsule.receipt`         | A receipt was written: `capsule.receipt.id`, `capsule.receipt.type`, `capsule.receipt.exit_code`. |
| `capsule.policy.denied`   | Policy refused the operation before the provider call: `capsule.policy.violation_count`.          |
| `capsule.outcome.pending` | The provider accepted the action and it has not reached a terminal state.                         |
| `capsule.outcome.unknown` | Capsule cannot tell whether the provider applied the action. Observe before retrying.             |

## Audit export

```sh
capsule audit export --receipt-file .capsule/receipts.jsonl --since 2026-11-01T00:00:00Z --until 2026-11-08T00:00:00Z --json
```

It streams two JSON lines per stored receipt that started in `[since, until)`: `{"kind":"receipt","at":...,"receipt":{...}}` with the receipt as stored, then `{"kind":"decision","at":...,"receipt_id":...,"provider":...,"capability":...,"decision":...,"notes":[...]}`. Both bounds are optional ISO 8601 times. A policy denial before the provider call writes no receipt, so it appears in spans, not in the export.

## Evidence

`node scripts/otel-evidence.mjs` (after `pnpm build`) runs the built worker with the SDK preloaded on the fixture profile, and a library run with a JSONL store followed by `capsule audit export`, and writes [evidence/observability.json](evidence/observability.json). It fails if a secret or raw approval ref reaches a span.
