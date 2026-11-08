import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { PolicyViolationError, UnsupportedCapabilityError } from "./errors.js";
import type { CapsuleReceipt } from "./types.js";

// A tracing hook shaped like the OpenTelemetry API, so `trace.getTracer("capsule")` from
// @opentelemetry/api fits as is and core takes no dependency. The caller brings the SDK and exporter.
// Spans carry identities, digests and outcomes only: never env values, raw approval refs, stdout or
// error text, and never argv unless asked for and the policy does not redact logs.

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, SpanAttributeValue>;

export interface CapsuleSpanLink {
  context: { traceId: string; spanId: string; traceFlags: number };
  attributes?: SpanAttributes;
}

export interface CapsuleSpan {
  setAttribute(key: string, value: SpanAttributeValue): unknown;
  addEvent(name: string, attributes?: SpanAttributes): unknown;
  setStatus(status: { code: 0 | 1 | 2; message?: string }): unknown;
  isRecording(): boolean;
  end(): void;
}

export interface CapsuleTracer {
  startSpan(name: string, options?: { kind?: number; attributes?: SpanAttributes; links?: CapsuleSpanLink[] }): CapsuleSpan;
}

export interface CapsuleTrace {
  tracer: CapsuleTracer;
  /** Added to every span, for example the operation id of a caller such as Fabric. */
  attributes?: SpanAttributes;
  /** Added to every span, for example the span of the caller's operation. */
  links?: CapsuleSpanLink[];
  /** Records the exec argv. Ignored when the policy redacts logs or the exec carries env. Default false. */
  argv?: boolean;
}

/** The span outcome: what Capsule knows happened at the provider. */
export type SpanOutcome = "completed" | "pending" | "denied" | "unsupported" | "unknown" | "failed";

/** SHA-256 hex of a value, so a span can be joined to a receipt without carrying the value. */
export function traceDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface TraceFrame {
  span: CapsuleSpan;
  operationId?: string;
}

const frames = new AsyncLocalStorage<TraceFrame>();

/** The span of the innermost traced operation, if any. */
export function activeTraceFrame(): TraceFrame | undefined {
  return frames.getStore();
}

/** Starts a span for one operation and runs it inside, recording the outcome. Rethrows unchanged. */
export async function inSpan<R>(trace: CapsuleTrace, action: string, attributes: SpanAttributes, run: () => Promise<R>): Promise<R> {
  const span = trace.tracer.startSpan(`capsule ${action}`, {
    kind: 2,
    attributes: { ...trace.attributes, ...attributes, "capsule.action": action },
    ...(trace.links?.length ? { links: trace.links } : {})
  });
  try {
    const operationId = attributes["capsule.operation.id"];
    const result = await frames.run({ span, ...(typeof operationId === "string" ? { operationId } : {}) }, run);
    const status = (result as { status?: unknown } | undefined)?.status;
    const pending = status === "queued" || status === "running" || status === "deploying";
    finish(span, pending ? "pending" : "completed");
    return result;
  } catch (error) {
    finish(span, outcomeOf(error), error);
    throw error;
  } finally {
    span.end();
  }
}

/** One span for an operation refused before it reached Capsule, for example by a bridge worker check. */
export function recordRefusal(trace: CapsuleTrace, action: string, attributes: SpanAttributes, refusal: { outcome: SpanOutcome; reason: string }): void {
  const span = trace.tracer.startSpan(`capsule ${action}`, {
    kind: 2,
    attributes: { ...trace.attributes, ...attributes, "capsule.action": action },
    ...(trace.links?.length ? { links: trace.links } : {})
  });
  span.setAttribute("capsule.refusal.reason", refusal.reason);
  finish(span, refusal.outcome);
  span.end();
}

export function outcomeOf(error: unknown): SpanOutcome {
  if (error instanceof PolicyViolationError) return "denied";
  if (error instanceof UnsupportedCapabilityError) return "unsupported";
  const outcome = (error as { outcome?: unknown } | undefined)?.outcome;
  return outcome === "pending" || outcome === "unknown" ? outcome : "failed";
}

function finish(span: CapsuleSpan, outcome: SpanOutcome, error?: unknown): void {
  span.setAttribute("capsule.outcome", outcome);
  if (outcome === "denied") {
    span.setAttribute("capsule.policy.decision", "denied");
    const violations = error instanceof PolicyViolationError ? error.notes.length : 0;
    span.addEvent("capsule.policy.denied", { "capsule.policy.violation_count": violations });
  }
  if (outcome === "pending" || outcome === "unknown") span.addEvent(`capsule.outcome.${outcome}`);
  if (error !== undefined) span.setAttribute("capsule.error.type", error instanceof Error ? error.name : typeof error);
  // Error text can carry provider output; the status keeps only the error type name.
  if (outcome !== "completed" && outcome !== "pending") span.setStatus({ code: 2, message: error instanceof Error ? error.name : outcome });
}

/** A receipt written inside a traced operation becomes an event on its span. */
export function traceReceipt(receipt: CapsuleReceipt): void {
  frames.getStore()?.span.addEvent("capsule.receipt", {
    "capsule.receipt.id": receipt.id,
    "capsule.receipt.type": receipt.type,
    ...(receipt.exitCode === undefined ? {} : { "capsule.receipt.exit_code": receipt.exitCode })
  });
}
