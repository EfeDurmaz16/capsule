import { createHash } from "node:crypto";
import { TracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { describe, expect, test } from "vitest";
import { parseWorkerConfig } from "./config.js";
import { FixtureProvider, fixtureDriver } from "./fixture.js";
import { readFixture, type ScenarioState } from "./harness.test.support.js";
import { fixtureProfile } from "./profiles.js";
import { WorkerSession } from "./session.js";
import { fabricOperationLink, parseTraceparent } from "./trace.js";
import { encodeFrame, FrameReader, decodeBody } from "./frame.js";
import { MAX_FRAME_BYTES } from "./wire.js";

const hello = readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message;
const createRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_create_valid.json").message;
const execRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_exec_valid.json").message;
const destroyRequest = readFixture<{ message: Record<string, unknown> }>("cases/request_destroy_valid.json").message;
const base = readFixture<{ provider_state: ScenarioState }>("scenarios/create_exec_destroy.json").provider_state;

function tracedSession(parent?: string) {
  const exporter = new InMemorySpanExporter();
  const tracerProvider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  const tracer = tracerProvider.getTracer("worker-test");
  const finished = async () => (await tracerProvider.forceFlush(), exporter.getFinishedSpans());
  const config = parseWorkerConfig({ binding: base.binding, policy: base.policy, approvals: base.approvals }, fixtureProfile);
  const provider = new FixtureProvider(base.binding, { sandboxes: [], script: [] });
  const received: Record<string, unknown>[] = [];
  const reader = new FrameReader(() => MAX_FRAME_BYTES);
  const session = new WorkerSession({
    driver: fixtureDriver(provider),
    config,
    trace: { tracer, ...(parent ? { parent } : {}) },
    io: {
      write: (frame) => {
        reader.push(frame);
        for (let body = reader.next(); body; body = reader.next()) received.push(decodeBody(body));
      },
      close: () => undefined,
      exit: () => undefined
    }
  });
  const next = async () => {
    for (let turn = 0; turn < 10_000; turn += 1) {
      const message = received.shift();
      if (message) return message;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("the worker wrote nothing");
  };
  const send = (message: object) => session.push(encodeFrame(message, MAX_FRAME_BYTES));
  return { finished, next, send };
}

describe("bridge worker tracing", () => {
  test("Fabric-driven operations carry Capsule spans with the Fabric operation id as attribute and link", async () => {
    const { finished, next, send } = tracedSession("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    send(hello);
    await next();
    for (const request of [createRequest, execRequest, destroyRequest]) {
      send(request);
      expect(await next()).toMatchObject({ type: "result", state: "completed" });
    }
    const spans = (await finished()).filter((span) => span.name !== "capsule sandbox.attach");
    expect(spans.map((span) => span.name)).toEqual(["capsule sandbox.create", "capsule sandbox.exec", "capsule sandbox.destroy"]);
    for (const [span, request] of spans.map((span, index) => [span, [createRequest, execRequest, destroyRequest][index]!] as const)) {
      const operation = (request.operation as { id: string }).id;
      expect(span.attributes).toMatchObject({ "fabric.operation.id": operation, "capsule.provider": "fixture", "capsule.outcome": "completed" });
      const link = fabricOperationLink(operation);
      expect(span.links.map((entry) => entry.context.spanId)).toEqual([link.context.spanId, "b7ad6b7169203331"]);
      expect(span.links[0]!.attributes).toEqual({ "fabric.operation.id": operation });
    }
  });

  test("a refusal before the facade still gets a denied span linked to the Fabric operation", async () => {
    const { finished, next, send } = tracedSession();
    send(hello);
    await next();
    send(createRequest);
    await next();
    send({
      ...destroyRequest,
      approval: null,
      request_id: "r-refused",
      operation: { ...(destroyRequest.operation as object), id: "01K8W3A000000000000000REF1", key: "key-refused" }
    });
    expect(await next()).toMatchObject({ type: "error", error: { reason: "approval_required" } });
    const span = (await finished()).at(-1);
    expect(span?.attributes).toMatchObject({
      "fabric.operation.id": "01K8W3A000000000000000REF1",
      "capsule.outcome": "denied",
      "capsule.refusal.reason": "approval_required"
    });
    expect(span?.links[0]?.attributes).toEqual({ "fabric.operation.id": "01K8W3A000000000000000REF1" });
  });

  test("the Fabric link is derived from the operation id alone, and TRACEPARENT is parsed strictly", () => {
    const id = "01K8W3A00000000000000000P1";
    const digest = createHash("sha256").update(`fabric.operation:${id}`).digest("hex");
    expect(fabricOperationLink(id).context).toEqual({ traceId: digest.slice(0, 32), spanId: digest.slice(32, 48), traceFlags: 1 });
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")?.context.spanId).toBe("b7ad6b7169203331");
    expect(parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeUndefined();
    expect(parseTraceparent("garbage")).toBeUndefined();
    expect(parseTraceparent(undefined)).toBeUndefined();
  });
});
