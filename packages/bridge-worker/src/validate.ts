import { NOT_AN_INTEGER } from "./frame.js";
import { actionCapability } from "./profiles.js";
import {
  ACTIONS,
  MAX_DRAIN_MS,
  MAX_FRAME_BYTES,
  MAX_REQUEST_BYTES,
  type BridgeAction,
  type BridgeRequest,
  type CapabilityProfile,
  type Cancel,
  type Hello,
  type HelloRefusedCode,
  type Observe,
  type RequestScope,
  type Shutdown,
  type WireLocator
} from "./wire.js";

// Parsers for Fabric to worker messages. They refuse instead of repairing: a request that would need
// sanitizing was built wrong. Each refusal names the v1 code and reason. Checks run in a fixed order
// (unknown fields, missing fields, then each field in document order) so one defect gives one answer.

/** A refusal of a request, observe or cancel, answered with an `error` frame and effect none. */
export class Refusal extends Error {
  constructor(
    readonly code: "invalid" | "unsupported" | "denied" | "unavailable" | "provider_failed",
    readonly reason: string,
    message?: string
  ) {
    super(message ?? `${code}: ${reason}`);
    this.name = "Refusal";
  }
}

/** A hello that cannot be accepted. */
export class HelloRefusal extends Error {
  constructor(
    readonly code: HelloRefusedCode,
    message: string
  ) {
    super(message);
    this.name = "HelloRefusal";
  }
}

const invalid = (reason: string, message?: string) => new Refusal("invalid", reason, message);

type Json = Record<string, unknown>;

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const GENERATION = /^[1-9][0-9]{0,19}$/;
const U64_MAX = 18_446_744_073_709_551_615n;
// Control characters except \n and \t; those two are allowed only in stdin and output text.
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NL_TAB = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks that `value` is an object with only `allowed` keys and every `required` key. */
function fields(value: unknown, allowed: readonly string[], required: readonly string[], what: string): Json {
  if (!isPlainObject(value)) throw invalid("missing_field", `${what} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalid("unknown_field", `${what} has unknown field ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) throw invalid("missing_field", `${what} is missing ${key}`);
  }
  return value;
}

function integer(value: unknown, what: string): number {
  if (value === NOT_AN_INTEGER || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw invalid("bad_integer", `${what} must be a JSON integer in 0..2^53-1`);
  }
  return value;
}

function bounded(value: unknown, min: number, max: number, what: string): number {
  const number = integer(value, what);
  if (number < min || number > max) throw invalid("limit", `${what} must be ${min} to ${max}`);
  return number;
}

function text(value: unknown, what: string, options: { min?: number; max?: number; allowNewlines?: boolean } = {}): string {
  if (typeof value !== "string") throw invalid("bad_string", `${what} must be a string`);
  const pattern = options.allowNewlines ? CONTROL_EXCEPT_NL_TAB : CONTROL;
  if (pattern.test(value)) throw invalid("bad_string", `${what} holds a control character`);
  if (value.length < (options.min ?? 0) || value.length > (options.max ?? Number.MAX_SAFE_INTEGER)) {
    throw invalid("bad_string", `${what} has a bad length`);
  }
  return value;
}

function id(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw invalid("bad_id", `${what} is not a valid id`);
  return value;
}

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID.test(value);
}

export function isKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

function generation(value: unknown): string {
  if (typeof value !== "string" || !GENERATION.test(value) || BigInt(value) > U64_MAX) {
    throw invalid("bad_integer", "scope.generation must be a canonical decimal string from 1");
  }
  return value;
}

function stringMap(value: unknown, what: string): Record<string, string> {
  if (!isPlainObject(value)) throw invalid("missing_field", `${what} must be an object`);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (CONTROL.test(key) || key.length === 0) throw invalid("bad_string", `${what} has a bad key`);
    out[key] = text(entry, `${what}.${key}`);
  }
  return out;
}

function names(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw invalid("missing_field", `${what} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0 || CONTROL.test(entry)) throw invalid("bad_string", `${what}[${index}] is not a name`);
    return entry;
  });
}

/**
 * A locator of this profile. Structure errors are `bad_locator`; whether its scope is the worker's own
 * is checked later as `denied`/`scope_mismatch`.
 */
export function parseLocator(value: unknown, profile: CapabilityProfile, what: string): WireLocator {
  const bad = (detail: string) => invalid("bad_locator", `${what}: ${detail}`);
  if (!isPlainObject(value)) throw bad("must be an object");
  for (const key of Object.keys(value)) {
    if (!["provider", "scope", "kind", "native_id", "native_operation_id"].includes(key)) throw bad(`unknown field ${key}`);
  }
  const { provider, scope, kind, native_id: nativeId, native_operation_id: nativeOperationId } = value;
  if (provider !== profile.provider) throw bad("provider is not the profile's");
  if (typeof kind !== "string" || !profile.resource_kinds.includes(kind)) throw bad("kind is not one of the profile's");
  if (!isPlainObject(scope)) throw bad("scope must be an object");
  const keys = Object.keys(scope);
  if (keys.length !== profile.scope_keys.length || !profile.scope_keys.every((key) => keys.includes(key))) {
    throw bad("scope keys are not exactly the profile's scope_keys");
  }
  const scopeOut: Record<string, string> = {};
  for (const key of profile.scope_keys) {
    const entry = scope[key];
    if (typeof entry !== "string" || entry.length < 1 || entry.length > 512 || CONTROL.test(entry)) throw bad(`scope.${key} is not 1 to 512 characters`);
    scopeOut[key] = entry;
  }
  if (!safeNativeId(nativeId)) throw bad("native_id is not a safe identifier");
  const locator: WireLocator = { provider, scope: scopeOut, kind, native_id: nativeId };
  if (nativeOperationId !== undefined) {
    if (!safeNativeId(nativeOperationId)) throw bad("native_operation_id is not a safe identifier");
    locator.native_operation_id = nativeOperationId;
  }
  return locator;
}

function safeNativeId(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || CONTROL.test(value) || /[?#]/.test(value)) return false;
  // No URL userinfo: user[:password]@host after a scheme.
  return !/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(value);
}

// Hello ----------------------------------------------------------------------------------------------

/** Parses a hello for a worker serving `profile`, or throws HelloRefusal. */
export function parseHello(message: Json, profile: CapabilityProfile, supported: { min: number; max: number }): Hello {
  let hello: Hello;
  try {
    const body = fields(message, ["type", "versions", "fabric", "profile", "limits"], ["type", "versions", "fabric", "profile", "limits"], "hello");
    const versions = fields(body.versions, ["min", "max"], ["min", "max"], "hello.versions");
    const min = integer(versions.min, "versions.min");
    const max = integer(versions.max, "versions.max");
    if (min < 1 || max < 1 || min > max) throw invalid("limit", "versions must be an inclusive range from 1");
    const fabric = text(body.fabric, "hello.fabric", { min: 1, max: 64 });
    if (typeof body.profile !== "string") throw invalid("bad_string", "hello.profile must be a string");
    const limits = fields(
      body.limits,
      ["max_request_bytes", "max_frame_bytes", "max_in_flight", "max_stderr_bytes"],
      ["max_request_bytes", "max_frame_bytes", "max_in_flight", "max_stderr_bytes"],
      "hello.limits"
    );
    hello = {
      type: "hello",
      versions: { min, max },
      fabric,
      profile: body.profile,
      limits: {
        max_request_bytes: bounded(limits.max_request_bytes, 1, MAX_REQUEST_BYTES, "max_request_bytes"),
        max_frame_bytes: bounded(limits.max_frame_bytes, 1, MAX_FRAME_BYTES, "max_frame_bytes"),
        max_in_flight: bounded(limits.max_in_flight, 1, 64, "max_in_flight"),
        max_stderr_bytes: bounded(limits.max_stderr_bytes, 0, 1 << 20, "max_stderr_bytes")
      }
    };
  } catch (error) {
    if (error instanceof Refusal) throw new HelloRefusal("invalid", error.message);
    throw error;
  }
  if (hello.versions.max < supported.min || hello.versions.min > supported.max) {
    throw new HelloRefusal("unsupported_version", `worker speaks bridge protocol ${supported.min} to ${supported.max}`);
  }
  if (hello.profile !== profile.profile) {
    throw new HelloRefusal("unsupported_profile", `worker serves profile ${profile.profile}`);
  }
  return hello;
}

// Session messages ---------------------------------------------------------------------------------

/**
 * The request_id and operation id an answer to `message` would carry, when both are usable. Without
 * them no `error` frame can correlate, so the caller answers with a protocol_error instead.
 */
export function correlation(message: Json): { requestId: string; operationId: string } | undefined {
  const requestId = message.request_id;
  if (!isKey(requestId)) return undefined;
  const operationId = message.type === "request" ? (isPlainObject(message.operation) ? message.operation.id : undefined) : message.operation_id;
  return isUlid(operationId) ? { requestId, operationId } : undefined;
}

/** The managed identities an effect belongs to: a request's own, or for an observe the original operation's. */
function parseScope(value: unknown): RequestScope {
  const body = fields(value, ["job", "task", "attempt", "generation"], ["job", "task", "attempt", "generation"], "scope");
  return {
    job: id(body.job, ULID, "scope.job"),
    task: id(body.task, ULID, "scope.task"),
    attempt: id(body.attempt, ULID, "scope.attempt"),
    generation: generation(body.generation)
  };
}

const REQUEST_FIELDS = ["type", "request_id", "operation", "scope", "action", "target", "params", "approval", "policy", "deadline_ms"] as const;
const REQUEST_REQUIRED = ["type", "request_id", "operation", "scope", "action", "params", "approval", "deadline_ms"] as const;

export function parseRequest(message: Json, profile: CapabilityProfile): BridgeRequest {
  const body = fields(message, REQUEST_FIELDS, REQUEST_REQUIRED, "request");
  const requestId = id(body.request_id, KEY, "request_id");
  const operation = fields(body.operation, ["id", "key", "digest"], ["id", "key", "digest"], "operation");
  const operationRef = {
    id: id(operation.id, ULID, "operation.id"),
    key: id(operation.key, KEY, "operation.key"),
    digest: id(operation.digest, DIGEST, "operation.digest")
  };
  const scope = parseScope(body.scope);
  const action = body.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action) || !actionCapability(profile, action)) {
    throw new Refusal("unsupported", "action", `action ${typeof action === "string" ? action : "?"} is not in the negotiated profile`);
  }
  const needsTarget = action !== "sandbox.create";
  if (needsTarget && !("target" in body)) throw invalid("missing_field", `${action} needs a target`);
  if (!needsTarget && "target" in body) throw invalid("unknown_field", "sandbox.create takes no target");
  const target = needsTarget ? parseLocator(body.target, profile, "target") : undefined;
  const limits = profile.limits;
  let params: BridgeRequest["params"];
  if (action === "sandbox.create") {
    const p = fields(body.params, ["image", "env", "secret_names", "labels"], ["image", "env", "secret_names", "labels"], "params");
    params = {
      image: text(p.image, "params.image"),
      env: stringMap(p.env, "params.env"),
      secret_names: names(p.secret_names, "params.secret_names"),
      labels: stringMap(p.labels, "params.labels")
    };
  } else if (action === "sandbox.exec") {
    const p = fields(
      body.params,
      ["argv", "stdin", "cwd", "timeout_ms", "max_output_bytes", "secret_names"],
      ["argv", "stdin", "cwd", "timeout_ms", "max_output_bytes", "secret_names"],
      "params"
    );
    if (!Array.isArray(p.argv)) throw invalid("missing_field", "params.argv must be an array");
    if (p.argv.length < 1 || p.argv.length > limits.max_argv) throw invalid("limit", `params.argv must hold 1 to ${limits.max_argv} strings`);
    const argv = p.argv.map((entry, index) => text(entry, `params.argv[${index}]`));
    const stdin = p.stdin === null ? null : text(p.stdin, "params.stdin", { allowNewlines: true });
    if (stdin !== null && Buffer.byteLength(stdin) > limits.max_stdin_bytes) throw invalid("limit", `params.stdin exceeds ${limits.max_stdin_bytes} bytes`);
    params = {
      argv,
      stdin,
      cwd: p.cwd === null ? null : text(p.cwd, "params.cwd"),
      timeout_ms: bounded(p.timeout_ms, 1, limits.max_deadline_ms, "params.timeout_ms"),
      max_output_bytes: bounded(p.max_output_bytes, 1, limits.max_output_bytes, "params.max_output_bytes"),
      secret_names: names(p.secret_names, "params.secret_names")
    };
  } else {
    fields(body.params, [], [], "params");
    params = {};
  }
  let approval: { ref: string } | null = null;
  if (body.approval !== null) {
    const a = fields(body.approval, ["ref"], ["ref"], "approval");
    approval = { ref: id(a.ref, KEY, "approval.ref") };
  }
  let policy: BridgeRequest["policy"];
  if ("policy" in body) {
    const p = fields(body.policy, ["secrets"], [], "policy");
    policy = {};
    if ("secrets" in p) {
      const s = fields(p.secrets, ["allowed"], [], "policy.secrets");
      policy.secrets = "allowed" in s ? { allowed: names(s.allowed, "policy.secrets.allowed") } : {};
    }
  }
  const deadlineMs = bounded(body.deadline_ms, 1, limits.max_deadline_ms, "deadline_ms");
  const request = {
    type: "request" as const,
    request_id: requestId,
    operation: operationRef,
    scope,
    action: action as BridgeAction,
    ...(target ? { target } : {}),
    params,
    approval,
    ...(policy ? { policy } : {}),
    deadline_ms: deadlineMs
  };
  return request as BridgeRequest;
}

export function parseObserve(message: Json, profile: CapabilityProfile): Observe {
  const keys = ["type", "request_id", "operation_id", "scope", "action", "resource", "wait_ms"] as const;
  const body = fields(message, keys, keys, "observe");
  const requestId = id(body.request_id, KEY, "request_id");
  const operationId = id(body.operation_id, ULID, "operation_id");
  const scope = parseScope(body.scope);
  const action = body.action;
  const capability = typeof action === "string" ? actionCapability(profile, action) : undefined;
  if (!capability) throw new Refusal("unsupported", "action", "observe names an action outside the negotiated profile");
  if (!capability.observe) throw new Refusal("unsupported", "observe", `${capability.action} has observe: false in this profile`);
  const resource = parseLocator(body.resource, profile, "resource");
  const waitMs = bounded(body.wait_ms, 1, profile.limits.max_observe_wait_ms, "wait_ms");
  return { type: "observe", request_id: requestId, operation_id: operationId, scope, action: capability.action, resource, wait_ms: waitMs };
}

export function parseCancel(message: Json): Cancel {
  const keys = ["type", "request_id", "cancels", "operation_id"] as const;
  const body = fields(message, keys, keys, "cancel");
  return {
    type: "cancel",
    request_id: id(body.request_id, KEY, "request_id"),
    cancels: id(body.cancels, KEY, "cancels"),
    operation_id: id(body.operation_id, ULID, "operation_id")
  };
}

/** Parses a shutdown. A shutdown has no operation to answer an error for, so a bad one is a Refusal the caller turns into a protocol_error. */
export function parseShutdown(message: Json): Shutdown {
  const keys = ["type", "request_id", "drain_ms"] as const;
  const body = fields(message, keys, keys, "shutdown");
  return { type: "shutdown", request_id: id(body.request_id, KEY, "request_id"), drain_ms: bounded(body.drain_ms, 1, MAX_DRAIN_MS, "drain_ms") };
}
