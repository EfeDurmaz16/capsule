import { createHash } from "node:crypto";
import type { CapsuleSpanLink, CapsuleTracer } from "@capsule-sdk/core";

// Tracing for Fabric-driven operations. The wire protocol carries no trace context, so each span links
// to a span context derived from the Fabric operation id alone: Fabric derives the same ids, and a
// trace backend joins both sides without a protocol change. A W3C TRACEPARENT in the worker's
// environment (OpenTelemetry's environment carrier) links every span to the session that spawned it.

export interface WorkerTrace {
  tracer: CapsuleTracer;
  /** A W3C traceparent for the process that spawned the worker, usually process.env.TRACEPARENT. */
  parent?: string;
}

/** The span link for one Fabric operation: trace and span id are the first 48 hex of sha256("fabric.operation:" + id). */
export function fabricOperationLink(operationId: string): CapsuleSpanLink {
  const digest = createHash("sha256").update(`fabric.operation:${operationId}`).digest("hex");
  return { context: { traceId: digest.slice(0, 32), spanId: digest.slice(32, 48), traceFlags: 1 }, attributes: { "fabric.operation.id": operationId } };
}

/** Parses a version 00 W3C traceparent; anything else, including all-zero ids, is ignored. */
export function parseTraceparent(value: string | undefined): CapsuleSpanLink | undefined {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value ?? "");
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) return undefined;
  return { context: { traceId: match[1]!, spanId: match[2]!, traceFlags: Number.parseInt(match[3]!, 16) & 1 } };
}

/**
 * The tracer of the provider an OpenTelemetry SDK registered in this process (for example with
 * `node --import ./otel.mjs`), or undefined when none did. It is read from the API's global slot,
 * where the SDK put it, so the worker imports nothing and traces wherever it is installed.
 */
export async function globalTracer(version: string): Promise<CapsuleTracer | undefined> {
  const api = (globalThis as Record<symbol, unknown>)[Symbol.for("opentelemetry.js.api.1")] as
    { trace?: { getTracer?: (name: string, version?: string) => CapsuleTracer } } | undefined;
  const provider = api?.trace;
  return typeof provider?.getTracer === "function" ? provider.getTracer("capsule-bridge-worker", version) : undefined;
}
