#!/usr/bin/env node
// Observability proof on the built packages, no network and no container engine needed:
//  1. the real capsule-bridge-worker bin, started with an OpenTelemetry SDK preloaded (node --import),
//     serves a Fabric-style create, exec with a secret, a refused destroy and a destroy on the fixture
//     profile; its spans are dumped from the SDK's in-memory exporter when it exits;
//  2. a library run of @capsule-sdk/core with a JSONL receipt store, then `capsule audit export` over it.
// Writes docs/evidence/observability.json and fails if any secret or raw approval ref reaches a span.
// Usage: pnpm build && node scripts/otel-evidence.mjs [--out <file>]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, hello, request, startWorker } from "./bridge-worker-client.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? process.argv[outArg + 1] : join(root, "docs", "evidence", "observability.json");
const SECRET = "sk_live_evidence_value_0123456789";
const APPROVAL_REF = "apr-destroy-evidence";
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const scratch = mkdtempSync(join(tmpdir(), "capsule-otel-evidence-"));
const resolveFromRoot = (name) => import.meta.resolve(name, pathToFileURL(join(root, "package.json")).href);

// The three-line setup the Observability docs page shows, with the in-memory exporter in place of OTLP.
const setup = join(scratch, "otel-setup.mjs");
writeFileSync(
  setup,
  `import { writeFileSync } from "node:fs";
import { trace } from ${JSON.stringify(resolveFromRoot("@opentelemetry/api"))};
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from ${JSON.stringify(resolveFromRoot("@opentelemetry/sdk-trace-base"))};
const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
process.on("exit", () => writeFileSync(process.env.CAPSULE_SPAN_DUMP, JSON.stringify(exporter.getFinishedSpans().map((span) => ({
  name: span.name, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, status: span.status,
  attributes: span.attributes, events: span.events.map((event) => ({ name: event.name, attributes: event.attributes ?? {} })),
  links: span.links.map((link) => ({ traceId: link.context.traceId, spanId: link.context.spanId, attributes: link.attributes ?? {} }))
})))));
`
);

function summarize(spans) {
  return spans.map(({ traceId: _trace, spanId: _span, ...rest }) => rest);
}

async function workerRun() {
  const config = join(scratch, "worker-config.json");
  writeFileSync(
    config,
    JSON.stringify({
      binding: { account: "acct-a", project: "proj-1" },
      policy: { images: ["fixture/ok"], secrets: { allowed: ["API_TOKEN"] } },
      approvals: [{ ref: APPROVAL_REF, action: "sandbox.destroy", native_id: null }]
    })
  );
  const dump = join(scratch, "worker-spans.json");
  const bin = join(root, "packages", "bridge-worker", "dist", "bin.js");
  const worker = startWorker({
    command: process.execPath,
    args: ["--import", pathToFileURL(setup).href, bin, "--profile", "fixture", "--config", config],
    cwd: scratch,
    env: { PATH: "", API_TOKEN: SECRET, TRACEPARENT, CAPSULE_SPAN_DUMP: dump }
  });
  worker.send(hello("fixture"));
  expect((await worker.next()).type === "hello_ack", "no hello_ack");
  worker.send(request(1, "sandbox.create", { params: { image: "fixture/ok", env: {}, secret_names: ["API_TOKEN"], labels: {} } }));
  const created = await worker.next();
  expect(created.type === "result", `create: ${JSON.stringify(created)}`);
  const target = created.resource;
  const argv = ["sh", "-c", `curl -H "Authorization: Bearer ${SECRET}" https://example.invalid`];
  worker.send(
    request(2, "sandbox.exec", { target, params: { argv, stdin: null, cwd: null, timeout_ms: 1000, max_output_bytes: 64, secret_names: ["API_TOKEN"] } })
  );
  const executed = await worker.next();
  expect(executed.type === "result", `exec: ${JSON.stringify(executed)}`);
  worker.send(request(3, "sandbox.destroy", { target, params: {} }));
  const refused = await worker.next();
  expect(refused.type === "error" && refused.error.reason === "approval_required", "destroy without approval was not refused");
  worker.send(request(4, "sandbox.destroy", { target, params: {}, approval: { ref: APPROVAL_REF } }));
  expect((await worker.next()).type === "result", "destroy failed");
  worker.end();
  const { code } = await worker.exit;
  expect(code === 0, `worker exited ${code}`);
  return { answers: [created.state, executed.state, refused.error.reason, "completed"], spans: JSON.parse(readFileSync(dump, "utf8")) };
}

async function libraryRun() {
  const { Capsule } = await import(pathToFileURL(join(root, "packages", "core", "dist", "index.js")).href);
  const { JsonlReceiptStore } = await import(pathToFileURL(join(root, "packages", "store-jsonl", "dist", "index.js")).href);
  const { trace } = await import(resolveFromRoot("@opentelemetry/api"));
  const { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = await import(resolveFromRoot("@opentelemetry/sdk-trace-base"));
  const exporter = new InMemorySpanExporter();
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
  const receiptFile = join(scratch, "receipts.jsonl");
  const adapter = {
    name: "evidence",
    provider: "evidence",
    capabilities: {
      job: { run: "native", status: "unsupported", cancel: "unsupported", logs: "unsupported", artifacts: "unsupported", timeout: "native", env: "native" }
    },
    job: {
      run: async (spec, context) => {
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt: new Date(),
              command: spec.command,
              exitCode: 0,
              stdout: "ok",
              stderr: "",
              policy: context.evaluatePolicy({ env: spec.env })
            })
          : undefined;
        return { id: "job-1", provider: "evidence", status: "succeeded", ...(receipt ? { receipt } : {}) };
      }
    }
  };
  const capsule = new Capsule({
    adapter,
    policy: { secrets: { allowed: ["API_TOKEN"], redactFromLogs: true } },
    receipts: true,
    receiptStore: new JsonlReceiptStore({ path: receiptFile }),
    receiptPersistence: "required",
    owner: { job: "job_evidence" },
    trace: { tracer: trace.getTracer("capsule-evidence") }
  });
  await capsule.job.run({ image: "debian:bookworm-slim", command: ["sh", "-c", `echo ${SECRET}`], env: { API_TOKEN: SECRET }, idempotencyKey: "evidence-1" });
  await capsule.job.run({ image: "debian:bookworm-slim", command: ["true"], env: { OTHER: SECRET } }).catch(() => undefined);
  const cli = join(root, "packages", "cli", "dist", "index.js");
  const exported = spawnSync(process.execPath, [cli, "audit", "export", "--receipt-file", receiptFile, "--since", "2000-01-01T00:00:00Z", "--json"], {
    encoding: "utf8"
  });
  expect(exported.status === 0, `audit export exited ${exported.status}: ${exported.stderr}`);
  const spans = exporter.getFinishedSpans().map((span) => ({
    name: span.name,
    status: span.status,
    attributes: span.attributes,
    events: span.events.map((event) => ({ name: event.name, attributes: event.attributes ?? {} })),
    links: []
  }));
  return {
    spans,
    audit: exported.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  };
}

try {
  const worker = await workerRun();
  const library = await libraryRun();
  const serialized = JSON.stringify([worker.spans, library.spans]);
  const leaks = [SECRET, APPROVAL_REF, "Authorization"].filter((value) => serialized.includes(value));
  expect(leaks.length === 0, `spans carry ${leaks.join(", ")}`);
  expect(!JSON.stringify(library.audit).includes(SECRET), "audit export carries the secret");
  const evidence = {
    generatedBy: relative(root, fileURLToPath(import.meta.url)),
    exporter:
      "OpenTelemetry SDK InMemorySpanExporter (sdk-trace-base 2.7.1, api 1.9.1). No container engine was running and no Jaeger image was present locally, so spans are dumped here instead of shown in Jaeger.",
    checks: {
      secretOrApprovalRefInSpans: false,
      secretInAuditExport: false,
      traceparentLinked: worker.spans.every((span) => span.links.some((link) => link.spanId === "00f067aa0ba902b7"))
    },
    worker: { profile: "fixture", answers: worker.answers, spans: summarize(worker.spans) },
    library: { spans: library.spans, auditExport: library.audit }
  };
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Wrote ${relative(root, out)}: ${worker.spans.length} worker spans, ${library.spans.length} library spans, ${library.audit.length} audit lines.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
