import { afterEach, expect, test, vi } from "vitest";

const KEY = Symbol.for("opentelemetry.js.api.1");
const slot = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete slot[KEY];
  vi.doUnmock("@opentelemetry/api");
  vi.resetModules();
});

test("the tracer comes from the provider the SDK registered, even when the API package does not resolve from the worker", async () => {
  vi.doMock("@opentelemetry/api", () => {
    throw new Error("Cannot find package '@opentelemetry/api'");
  });
  const tracer = { startSpan: vi.fn() };
  const getTracer = vi.fn(() => tracer);
  slot[KEY] = { version: "1.10.0", trace: { getTracer } };
  const { globalTracer } = await import("./trace.js");
  expect(await globalTracer("worker-1")).toBe(tracer);
  expect(getTracer).toHaveBeenCalledWith("capsule-bridge-worker", "worker-1");
});

test("no registered tracer provider means no tracing", async () => {
  const { globalTracer } = await import("./trace.js");
  expect(await globalTracer("worker-1")).toBeUndefined();
  slot[KEY] = { version: "1.10.0" };
  expect(await globalTracer("worker-1")).toBeUndefined();
});
