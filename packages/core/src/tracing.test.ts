import { createHash } from "node:crypto";
import { trace as otelTrace, type Tracer } from "@opentelemetry/api";
import { AlwaysOffSampler, TracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from "@opentelemetry/sdk-trace";
import { describe, expect, test } from "vitest";
import {
  Capsule,
  MemoryReceiptStore,
  PendingOperationError,
  PolicyViolationError,
  UnknownOutcomeError,
  type CapsuleAdapter,
  type CapsuleApprovalGrant,
  type CapsuleTrace
} from "./index.js";
import { inSpan } from "./tracing.js";

const SECRET = "sk_live_tracing_secret_value_1234567890";
const APPROVAL_ID = "approval-ref-raw-7f3a";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function recorder(options: { off?: boolean } = {}) {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
    ...(options.off ? { sampler: new AlwaysOffSampler() } : {})
  });
  return { tracer: provider.getTracer("capsule-test"), finished: async () => (await provider.forceFlush(), exporter.getFinishedSpans()) };
}

function adapter(behaviour: { exec?: () => Promise<never>; jobStatus?: "queued" | "succeeded" } = {}): CapsuleAdapter {
  let next = 0;
  return {
    name: "fake",
    provider: "fake",
    capabilities: {
      sandbox: { create: "native", exec: "native", fileRead: "native", fileWrite: "native", fileList: "native", destroy: "native" },
      job: {
        run: "native",
        status: "unsupported",
        cancel: "unsupported",
        logs: "unsupported",
        artifacts: "unsupported",
        timeout: "unsupported",
        env: "unsupported"
      }
    },
    sandbox: {
      create: async (spec) => {
        const id = `sb-${(next += 1)}`;
        const handle = { id, provider: "fake", createdAt: "2026-11-08T00:00:00.000Z", labels: spec.labels };
        return {
          handle,
          exec: behaviour.exec ?? (async () => ({ exitCode: 0, stdout: `out ${SECRET}`, stderr: "", logs: [], artifacts: [] })),
          writeFile: async () => undefined,
          readFile: async () => new Uint8Array(),
          listFiles: async () => [],
          destroy: async () => undefined
        };
      }
    },
    job: {
      run: async () => ({ id: "job-1", provider: "fake", status: behaviour.jobStatus ?? "succeeded" })
    }
  };
}

const grant = (capability: string): CapsuleApprovalGrant => ({
  approved: true,
  id: APPROVAL_ID,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  capabilities: [capability]
});

/** Every string an exported span carries: name, attributes, events, links and status. */
function strings(spans: ReadableSpan[]): string[] {
  const out: string[] = [];
  const add = (record: Record<string, unknown> | undefined) => {
    for (const [key, value] of Object.entries(record ?? {})) out.push(key, String(value));
  };
  for (const span of spans) {
    out.push(span.name, span.status.message ?? "");
    add(span.attributes);
    for (const event of span.events) {
      out.push(event.name);
      add(event.attributes);
    }
    for (const link of span.links) add(link.attributes);
  }
  return out;
}

async function scenario(trace: CapsuleTrace | undefined, adapterBehaviour: Parameters<typeof adapter>[0] = {}) {
  const store = new MemoryReceiptStore();
  const capsule = new Capsule({
    adapter: adapter(adapterBehaviour),
    policy: { approvals: { required: true }, secrets: { allowed: ["API_TOKEN"], redactFromLogs: true } },
    receipts: true,
    receiptStore: store,
    owner: { job: "job_trace" },
    ...(trace ? { trace } : {})
  });
  const sandbox = await capsule.sandbox.create({
    env: { API_TOKEN: SECRET },
    approval: { ...grant("sandbox.create"), capabilities: ["sandbox.create", "sandbox.exec"] },
    idempotencyKey: "idem-create-1"
  });
  const result = await sandbox.exec({ command: ["sh", "-c", `curl -H "Authorization: Bearer ${SECRET}" x`], env: { API_TOKEN: SECRET } });
  const denied = await sandbox.exec({ command: "true", env: { NOT_ALLOWED: SECRET } }).then(
    () => "allowed",
    (error: unknown) => (error instanceof PolicyViolationError ? "denied" : "other")
  );
  await sandbox.destroy({ approval: grant("sandbox.destroy") });
  return { result: { exitCode: result.exitCode, stdout: result.stdout }, denied, receipts: store.receipts.map((receipt) => receipt.type) };
}

describe("tracing hook", () => {
  test("every operation gets a span with operation id, job, provider, action, outcome, digests and policy decision", async () => {
    const { finished, tracer } = recorder();
    await scenario({ tracer, attributes: { "fabric.operation.id": "op_fabric_1" } });
    const spans = await finished();
    expect(spans.map((span) => span.name)).toEqual(["capsule sandbox.create", "capsule sandbox.exec", "capsule sandbox.exec", "capsule sandbox.destroy"]);
    const [create, exec, denied, destroy] = spans as [ReadableSpan, ReadableSpan, ReadableSpan, ReadableSpan];
    expect(create.attributes).toMatchObject({
      "capsule.operation.id": expect.stringMatching(/^op_[0-9a-f]{32}$/),
      "capsule.job": "job_trace",
      "capsule.provider": "fake",
      "capsule.adapter": "fake",
      "capsule.action": "sandbox.create",
      "capsule.outcome": "completed",
      "capsule.policy.decision": "allowed",
      "capsule.idempotency.key_digest": sha("idem-create-1"),
      "capsule.approval.ref_digest": sha(APPROVAL_ID),
      "fabric.operation.id": "op_fabric_1"
    });
    expect(exec.attributes).toMatchObject({ "capsule.action": "sandbox.exec", "capsule.outcome": "completed", "capsule.command.argc": 3 });
    expect(exec.events.map((event) => event.name)).toContain("capsule.receipt");
    expect(destroy.events.map((event) => event.name)).toContain("capsule.receipt");
    expect(denied.attributes).toMatchObject({ "capsule.outcome": "denied", "capsule.policy.decision": "denied" });
    expect(denied.events.map((event) => event.name)).toContain("capsule.policy.denied");
    expect(denied.status.code).toBe(2);
    expect(destroy.attributes).toMatchObject({ "capsule.action": "sandbox.destroy", "capsule.outcome": "completed" });
  });

  test("no secret value, raw approval ref or sensitive argv reaches any attribute, event, link or status", async () => {
    const { finished, tracer } = recorder();
    await scenario({ tracer, argv: true });
    const all = strings(await finished()).join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(APPROVAL_ID);
    expect(all).not.toContain("Authorization");
  });

  test("pending and unknown outcomes are span events, and the error status carries no message text", async () => {
    const { finished, tracer } = recorder();
    const capsule = new Capsule({ adapter: adapter({ jobStatus: "queued" }), trace: { tracer } });
    await capsule.job.run({ image: "debian", command: ["true"] });
    const unknown = new Capsule({
      adapter: adapter({ exec: async () => Promise.reject(new UnknownOutcomeError(`dropped ${SECRET}`, { operation: "sandbox.exec" })) }),
      trace: { tracer }
    });
    const sandbox = await unknown.sandbox.create({});
    await expect(sandbox.exec({ command: "true" })).rejects.toBeInstanceOf(UnknownOutcomeError);
    const pendingCapsule = new Capsule({
      adapter: adapter({
        exec: async () => Promise.reject(new PendingOperationError("still going", { operation: "sandbox.exec", resource: { id: "sb-1" } as never }))
      }),
      trace: { tracer }
    });
    await expect((await pendingCapsule.sandbox.create({})).exec({ command: "true" })).rejects.toBeInstanceOf(PendingOperationError);
    const spans = await finished();
    const job = spans.find((span) => span.attributes["capsule.action"] === "job.run")!;
    expect(job.attributes["capsule.outcome"]).toBe("pending");
    expect(job.events.map((event) => event.name)).toContain("capsule.outcome.pending");
    const execs = spans.filter((span) => span.attributes["capsule.action"] === "sandbox.exec");
    expect(execs.map((span) => span.attributes["capsule.outcome"])).toEqual(["unknown", "pending"]);
    expect(execs[0]!.events.map((event) => event.name)).toContain("capsule.outcome.unknown");
    expect(strings(spans).join("\n")).not.toContain(SECRET);
  });

  test("sampling off and no tracer give the same results, receipts and denials as a recording tracer", async () => {
    const plain = await scenario(undefined);
    const { finished, tracer } = recorder({ off: true });
    const off = await scenario({ tracer });
    const recording = await scenario({ tracer: recorder().tracer });
    expect(off).toEqual(plain);
    expect(recording).toEqual(plain);
    expect(await finished()).toHaveLength(0);
  });

  test("links passed in the trace options are carried on every span", async () => {
    const { finished, tracer } = recorder();
    const link = {
      context: { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 1 },
      attributes: { "fabric.operation.id": "op_x" }
    };
    await new Capsule({ adapter: adapter(), trace: { tracer, links: [link] } }).sandbox.create({});
    const [span] = await finished();
    expect(span!.links).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ traceId: link.context.traceId, spanId: link.context.spanId }) })
    ]);
  });

  test("a provider status sets the outcome: in-progress is pending, failed or partial is failed, the rest completed", async () => {
    const { finished, tracer } = recorder();
    const cases: Array<[string, string, string]> = [
      ["job.run", "queued", "pending"],
      ["job.status", "running", "pending"],
      ["service.deploy", "deploying", "pending"],
      ["edge.version", "building", "pending"],
      ["edge.release", "releasing", "pending"],
      ["edge.rollback", "rolling_back", "pending"],
      ["database.branch.reset", "resetting", "pending"],
      ["database.migrate", "running", "pending"],
      ["machine.create", "creating", "pending"],
      ["machine.start", "starting", "pending"],
      ["machine.stop", "stopping", "pending"],
      ["machine.destroy", "destroying", "pending"],
      ["preview.create", "creating", "pending"],
      ["preview.delete", "deleting", "pending"],
      ["job.cancel", "cancelling", "pending"],
      ["machine.start", "running", "completed"],
      ["edge.version", "created", "completed"],
      ["job.status", "succeeded", "completed"],
      ["service.deploy", "ready", "completed"],
      ["service.deploy", "failed", "failed"],
      ["edge.version", "failed", "failed"],
      ["preview.cleanup", "partial", "failed"]
    ];
    for (const [action, status] of cases) await inSpan({ tracer }, action, {}, async () => ({ status }));
    const spans = await finished();
    expect(spans.map((span) => [span.attributes["capsule.action"], span.attributes["capsule.result.status"], span.attributes["capsule.outcome"]])).toEqual(
      cases
    );
    for (const span of spans) {
      const outcome = span.attributes["capsule.outcome"];
      expect(span.status.code).toBe(outcome === "failed" ? 2 : 0);
      expect(span.events.some((event) => event.name === "capsule.outcome.pending")).toBe(outcome === "pending");
    }
  });

  test("an OpenTelemetry API tracer is accepted as is", () => {
    const tracer: Tracer = otelTrace.getTracer("capsule");
    const trace: CapsuleTrace = { tracer };
    expect(trace.tracer).toBe(tracer);
  });
});
