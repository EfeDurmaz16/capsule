import { isKey, isPlainObject, isUlid, parseLocator, Refusal } from "./validate.js";
import { ERROR_EFFECTS, ERROR_REASONS, type CapabilityProfile, type ErrorCode, type HelloLimits } from "./wire.js";

// A checker for worker to Fabric messages, with the reasons Fabric gives for a protocol_violation. The
// worker's own tests run every frame it writes through it, and the shared worker_to_fabric cases pin
// the reasons, so both sides refuse the same messages.

export interface OutboundViolation {
  code: "protocol_violation";
  reason: "missing_field" | "unknown_field" | "unknown_variant" | "effect_mismatch" | "limit_raised" | "profile_mismatch" | "bad_value";
  detail: string;
}

export interface OutboundContext {
  /** The profile the worker negotiated, or that Fabric asked for during the handshake. */
  profile: CapabilityProfile;
  /** Fabric's hello limits, for checking a hello_ack. */
  helloLimits?: HelloLimits;
}

class Violation extends Error {
  constructor(
    readonly reason: OutboundViolation["reason"],
    readonly detail: string
  ) {
    super(detail);
  }
}

function only(value: unknown, allowed: readonly string[], required: readonly string[], what: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Violation("missing_field", `${what} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Violation("unknown_field", `${what}.${key}`);
  for (const key of required) if (!(key in value)) throw new Violation("missing_field", `${what}.${key}`);
  return value;
}

function locator(value: unknown, context: OutboundContext, what: string): void {
  if (!isPlainObject(value)) throw new Violation("missing_field", `${what} must be a locator`);
  for (const key of ["provider", "scope", "kind", "native_id"]) if (!(key in value)) throw new Violation("missing_field", `${what}.${key}`);
  try {
    parseLocator(value, context.profile, what);
  } catch (error) {
    if (error instanceof Refusal) throw new Violation("bad_value", error.message);
    throw error;
  }
}

function count(value: unknown, what: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Violation("bad_value", `${what} must be an integer`);
}

function stream(value: unknown, what: string): void {
  const body = only(value, ["text", "captured_bytes", "truncated", "lossy"], ["text", "captured_bytes", "truncated", "lossy"], what);
  if (typeof body.text !== "string" || typeof body.truncated !== "boolean" || typeof body.lossy !== "boolean") {
    throw new Violation("bad_value", `${what} has a wrong field type`);
  }
  count(body.captured_bytes, `${what}.captured_bytes`);
}

/** Returns the violation Fabric would report for `message`, or undefined when Fabric accepts it. */
export function checkWorkerMessage(message: unknown, context: OutboundContext): OutboundViolation | undefined {
  try {
    check(message, context);
    return undefined;
  } catch (error) {
    if (error instanceof Violation) return { code: "protocol_violation", reason: error.reason, detail: error.detail };
    throw error;
  }
}

function check(message: unknown, context: OutboundContext): void {
  if (!isPlainObject(message) || typeof message.type !== "string") throw new Violation("missing_field", "type");
  switch (message.type) {
    case "hello_ack": {
      const body = only(message, ["type", "protocol", "worker", "profile", "limits"], ["type", "protocol", "worker", "profile", "limits"], "hello_ack");
      if (body.protocol !== 1) throw new Violation("bad_value", "protocol");
      if (typeof body.worker !== "string" || body.worker.length < 1 || body.worker.length > 64) throw new Violation("bad_value", "worker");
      if (!isPlainObject(body.profile) || body.profile.profile !== context.profile.profile) throw new Violation("profile_mismatch", "profile");
      const limits = only(
        body.limits,
        ["max_request_bytes", "max_frame_bytes", "max_in_flight", "max_stderr_bytes"],
        ["max_request_bytes", "max_frame_bytes", "max_in_flight", "max_stderr_bytes"],
        "limits"
      );
      for (const [key, value] of Object.entries(limits)) {
        count(value, `limits.${key}`);
        const asked = context.helloLimits?.[key as keyof HelloLimits];
        if (asked !== undefined && (value as number) > asked) throw new Violation("limit_raised", `limits.${key}`);
      }
      return;
    }
    case "hello_refused": {
      const body = only(message, ["type", "versions", "reason"], ["type", "versions", "reason"], "hello_refused");
      only(body.versions, ["min", "max"], ["min", "max"], "versions");
      const reason = only(body.reason, ["code", "message"], ["code", "message"], "reason");
      if (!["unsupported_version", "unsupported_profile", "invalid"].includes(reason.code as string)) throw new Violation("unknown_variant", "reason.code");
      return;
    }
    case "result": {
      const body = only(
        message,
        ["type", "request_id", "operation_id", "state", "resource", "output", "replayed", "receipts", "evidence_error"],
        ["type", "request_id", "operation_id", "state", "resource", "output", "replayed", "receipts"],
        "result"
      );
      correlate(body);
      if (!["completed", "cancelled", "accepted", "running"].includes(body.state as string)) throw new Violation("unknown_variant", "state");
      locator(body.resource, context, "resource");
      if (typeof body.replayed !== "boolean") throw new Violation("bad_value", "replayed");
      if (!Array.isArray(body.receipts) || body.receipts.length > context.profile.limits.max_receipts) throw new Violation("bad_value", "receipts");
      for (const [index, receipt] of body.receipts.entries()) {
        const entry = only(receipt, ["algorithm", "digest", "ref"], ["algorithm", "digest", "ref"], `receipts[${index}]`);
        if (entry.algorithm !== "sha256" || typeof entry.digest !== "string" || !/^[0-9a-f]{64}$/.test(entry.digest)) {
          throw new Violation("bad_value", `receipts[${index}]`);
        }
      }
      const output = only(body.output, ["status", "exit_code", "stdout", "stderr"], [], "output");
      if ("status" in output) {
        if (!["ready", "destroyed"].includes(output.status as string) || Object.keys(output).length !== 1) throw new Violation("bad_value", "output");
      } else {
        only(output, ["exit_code", "stdout", "stderr"], ["exit_code", "stdout", "stderr"], "output");
        if (output.exit_code !== null) count(output.exit_code, "output.exit_code");
        stream(output.stdout, "output.stdout");
        stream(output.stderr, "output.stderr");
      }
      if ("evidence_error" in body) {
        const evidence = only(body.evidence_error, ["reason", "message"], ["reason", "message"], "evidence_error");
        if (evidence.reason !== "receipt_write_failed") throw new Violation("unknown_variant", "evidence_error.reason");
      }
      return;
    }
    case "error": {
      const body = only(message, ["type", "request_id", "operation_id", "error"], ["type", "request_id", "operation_id", "error"], "error");
      correlate(body);
      const error = only(
        body.error,
        ["code", "reason", "message", "effect", "resource", "state", "observations", "deadline_ms", "cleanup"],
        ["code", "reason", "message", "effect"],
        "error"
      );
      const code = error.code as ErrorCode;
      if (!(code in ERROR_REASONS)) throw new Violation("unknown_variant", "error.code");
      if (!ERROR_REASONS[code].includes(error.reason as string)) throw new Violation("unknown_variant", "error.reason");
      if (!ERROR_EFFECTS[code].includes(error.effect as never)) throw new Violation("effect_mismatch", `${code} with effect ${String(error.effect)}`);
      if (typeof error.message !== "string" || error.message.length > 1024) throw new Violation("bad_value", "error.message");
      const locatorRequired = code === "pending" || (code === "provider_failed" && error.effect === "applied");
      if (locatorRequired && !("resource" in error)) throw new Violation("missing_field", "error.resource");
      if ("resource" in error) locator(error.resource, context, "error.resource");
      if ("observations" in error) count(error.observations, "error.observations");
      if ("deadline_ms" in error) count(error.deadline_ms, "error.deadline_ms");
      if ("state" in error && typeof error.state !== "string") throw new Violation("bad_value", "error.state");
      if ("cleanup" in error) {
        const cleanup = only(error.cleanup, ["status", "residual"], ["status", "residual"], "error.cleanup");
        if (!["not-attempted", "succeeded", "failed", "pending", "unknown"].includes(cleanup.status as string))
          throw new Violation("unknown_variant", "cleanup.status");
        if (!Array.isArray(cleanup.residual)) throw new Violation("bad_value", "cleanup.residual");
        cleanup.residual.forEach((entry, index) => locator(entry, context, `cleanup.residual[${index}]`));
      }
      return;
    }
    case "progress": {
      const body = only(
        message,
        ["type", "request_id", "operation_id", "seq", "state", "resource"],
        ["type", "request_id", "operation_id", "seq", "state", "resource"],
        "progress"
      );
      correlate(body);
      count(body.seq, "seq");
      if ((body.seq as number) < 1 || (body.seq as number) > 16) throw new Violation("bad_value", "seq");
      if (typeof body.state !== "string") throw new Violation("bad_value", "state");
      locator(body.resource, context, "resource");
      return;
    }
    case "cancel_ack": {
      const body = only(message, ["type", "request_id", "cancels", "state"], ["type", "request_id", "cancels", "state"], "cancel_ack");
      if (!isKey(body.request_id) || !isKey(body.cancels)) throw new Violation("bad_value", "request_id");
      if (!["requested", "not_found", "already_answered", "unsupported"].includes(body.state as string)) throw new Violation("unknown_variant", "state");
      return;
    }
    case "shutdown_ack": {
      const body = only(message, ["type", "request_id", "unresolved"], ["type", "request_id", "unresolved"], "shutdown_ack");
      if (!isKey(body.request_id) || !Array.isArray(body.unresolved)) throw new Violation("bad_value", "shutdown_ack");
      body.unresolved.forEach((entry, index) => {
        const item = only(entry, ["request_id", "operation_id", "state", "resource"], ["request_id", "operation_id", "state"], `unresolved[${index}]`);
        correlate(item);
        if (!["pending", "unknown"].includes(item.state as string)) throw new Violation("unknown_variant", `unresolved[${index}].state`);
        if (item.state === "pending" && !("resource" in item)) throw new Violation("missing_field", `unresolved[${index}].resource`);
        if ("resource" in item) locator(item.resource, context, `unresolved[${index}].resource`);
      });
      return;
    }
    case "protocol_error": {
      const body = only(message, ["type", "code", "message"], ["type", "code", "message"], "protocol_error");
      if (!["oversize", "truncated", "empty", "malformed", "unexpected"].includes(body.code as string)) throw new Violation("unknown_variant", "code");
      return;
    }
    default:
      throw new Violation("unknown_variant", `type ${message.type}`);
  }
}

function correlate(body: Record<string, unknown>): void {
  if (!isKey(body.request_id)) throw new Violation("bad_value", "request_id");
  if (!isUlid(body.operation_id)) throw new Violation("bad_value", "operation_id");
}
