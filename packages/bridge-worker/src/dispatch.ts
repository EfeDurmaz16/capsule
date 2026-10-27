import { createHash } from "node:crypto";
import {
  AdapterExecutionError,
  Capsule,
  CleanupFailureError,
  PartialEffectsError,
  PendingOperationError,
  PolicyViolationError,
  UnknownOutcomeError,
  UnsupportedCapabilityError,
  canonicalReceiptPayload,
  mergePolicy,
  partialEffectsOf,
  type CapsuleApprovalGrant,
  type CapsulePolicy,
  type CapsuleReceipt,
  type ExecResult,
  type ReceiptStore,
  type ResourceLocator
} from "@capsule-sdk/core";
import { resolveApproval, type WorkerConfig } from "./config.js";
import type { BridgeDriver, OperationHooks, ResourceState } from "./driver.js";
import { ExecCancelledError } from "./fixture.js";
import { BridgePendingError, BridgeUnknownError, observeUntilTerminal, type OperationTimer } from "./observe.js";
import { actionCapability } from "./profiles.js";
import { Refusal } from "./validate.js";
import type {
  BridgeAction,
  BridgeRequest,
  CleanupReport,
  ErrorBody,
  ErrorMessage,
  ExecStream,
  Observe,
  ReceiptRef,
  Result,
  ResultOutput,
  WireLocator
} from "./wire.js";

// Turning one validated request or observe into provider work and exactly one answer. The checks run
// in a fixed order and stop at the first failure, all before any provider effect: locator scope,
// idempotency, owner, policy (images, secrets), approval. Only then does the worker call the Capsule
// facade, which evaluates policy and the fresh grant again before the adapter runs.

/** Interrupts an await when a shutdown drain ends for the operation. */
export class DrainInterrupt extends Error {
  constructor() {
    super("shutdown drain ended");
    this.name = "DrainInterrupt";
  }
}

/** The in-flight state the dispatcher needs from the session. */
export interface OperationRuntime {
  readonly requestId: string;
  readonly operationId: string;
  readonly timer: OperationTimer;
  readonly cancel: AbortSignal;
  /** Aborted when the shutdown drain for this operation ends. */
  readonly drained: AbortSignal;
  /** Drain end in the timer's time; undefined while not draining. */
  drainAt(): number | undefined;
  /** Reports provider progress; the session decides whether to send it. */
  progress(state: string, resource: WireLocator): void;
}

export type Answer = Result | ErrorMessage;

interface StoredAnswer {
  digest: string;
  answer?: Answer;
}

/** Answers per operation key, per connection and bounded. The table does not survive the worker. */
export class IdempotencyTable {
  private readonly entries = new Map<string, StoredAnswer>();

  constructor(private readonly capacity = 4096) {}

  get(key: string): StoredAnswer | undefined {
    return this.entries.get(key);
  }

  begin(key: string, digest: string): void {
    this.entries.set(key, { digest });
  }

  abandon(key: string): void {
    this.entries.delete(key);
  }

  finish(key: string, answer: Answer): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.answer = answer;
    while (this.entries.size > this.capacity) {
      const oldest = [...this.entries].find(([, value]) => value.answer !== undefined);
      if (!oldest) break;
      this.entries.delete(oldest[0]);
    }
  }
}

export interface DispatchContext {
  driver: BridgeDriver;
  config: WorkerConfig;
  idempotency: IdempotencyTable;
  diagnostic(text: string): void;
}

const errorMessage = (code: string, reason: string) => `${code}: ${reason}`;

export function refusalAnswer(requestId: string, operationId: string, refusal: Refusal): ErrorMessage {
  return {
    type: "error",
    request_id: requestId,
    operation_id: operationId,
    error: { code: refusal.code, reason: refusal.reason, message: errorMessage(refusal.code, refusal.reason), effect: "none" }
  };
}

function guarded<T>(runtime: OperationRuntime, promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  if (runtime.drained.aborted) return Promise.reject(new DrainInterrupt());
  return new Promise<T>((resolve, reject) => {
    const onDrain = () => reject(new DrainInterrupt());
    runtime.drained.addEventListener("abort", onDrain, { once: true });
    promise.then(
      (value) => {
        runtime.drained.removeEventListener("abort", onDrain);
        resolve(value);
      },
      (error) => {
        runtime.drained.removeEventListener("abort", onDrain);
        reject(error);
      }
    );
  });
}

/** Evidence for one operation: receipts written through it, and a write failure kept apart from the outcome. */
class OperationEvidence implements ReceiptStore {
  readonly refs: ReceiptRef[] = [];
  failure: string | undefined;

  constructor(
    private readonly inner: ReceiptStore | undefined,
    private readonly durable: boolean
  ) {}

  async ready(): Promise<void> {
    await this.inner?.ready?.();
  }

  async write(receipt: CapsuleReceipt): Promise<void> {
    if (!this.inner) return;
    try {
      await this.inner.write(receipt);
      if (this.durable) {
        this.refs.push({ algorithm: "sha256", digest: createHash("sha256").update(canonicalReceiptPayload(receipt)).digest("hex"), ref: receipt.id });
      }
    } catch (error) {
      // Rule 10: a failed receipt write never erases the action's outcome. It travels as evidence_error.
      this.failure ??= error instanceof Error && error.message ? error.message.slice(0, 1024) : "receipt write failed";
    }
  }
}

function toWire(locator: ResourceLocator, driver: BridgeDriver, binding: Record<string, string>): WireLocator {
  // The worker builds every wire locator itself from the native id, with the profile's kind and the
  // worker's bound scope, so an adapter's internal locator shape never leaks onto the wire.
  return {
    provider: driver.profile.provider,
    scope: { ...binding },
    kind: driver.profile.resource_kinds[0]!,
    native_id: locator.nativeId,
    ...(locator.nativeOperationId ? { native_operation_id: locator.nativeOperationId } : {})
  };
}

function wireLocator(nativeId: string, driver: BridgeDriver, binding: Record<string, string>): WireLocator {
  return { provider: driver.profile.provider, scope: { ...binding }, kind: driver.profile.resource_kinds[0]!, native_id: nativeId };
}

function coreLocator(locator: WireLocator): ResourceLocator {
  return { provider: locator.provider, kind: locator.kind, nativeId: locator.native_id, scope: locator.scope };
}

function sameScope(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function stream(text: string, truncation: { truncated?: boolean; capturedBytes?: number } | undefined): ExecStream {
  return {
    text,
    captured_bytes: truncation?.capturedBytes ?? Buffer.byteLength(text),
    truncated: truncation?.truncated ?? false,
    lossy: text.includes("�")
  };
}

const emptyStream: ExecStream = { text: "", captured_bytes: 0, truncated: false, lossy: false };

function execOutput(result: ExecResult): ResultOutput {
  return { exit_code: result.exitCode, stdout: stream(result.stdout, result.truncation?.stdout), stderr: stream(result.stderr, result.truncation?.stderr) };
}

function result(
  runtime: OperationRuntime,
  state: Result["state"],
  resource: WireLocator,
  output: ResultOutput,
  evidence?: OperationEvidence,
  replayed = false
): Result {
  return {
    type: "result",
    request_id: runtime.requestId,
    operation_id: runtime.operationId,
    state,
    resource,
    output,
    replayed,
    receipts: evidence ? evidence.refs.slice(0, 16) : [],
    ...(evidence?.failure !== undefined ? { evidence_error: { reason: "receipt_write_failed" as const, message: evidence.failure } } : {})
  };
}

function errorAnswer(runtime: OperationRuntime, body: Omit<ErrorBody, "message">): ErrorMessage {
  return {
    type: "error",
    request_id: runtime.requestId,
    operation_id: runtime.operationId,
    error: { ...body, message: errorMessage(body.code, body.reason) } as ErrorBody
  };
}

/** Maps what the facade or an observation threw after dispatch to the one answer that is true. */
function outcomeAnswer(
  runtime: OperationRuntime,
  error: unknown,
  driver: BridgeDriver,
  binding: Record<string, string>,
  best: WireLocator | undefined,
  diagnostic: (text: string) => void
): ErrorMessage {
  if (error instanceof Refusal) return refusalAnswer(runtime.requestId, runtime.operationId, error);
  if (error instanceof PendingOperationError) {
    return errorAnswer(runtime, {
      code: "pending",
      reason: error instanceof BridgePendingError ? error.reason : "observation_deadline",
      effect: "pending",
      resource: toWire(error.resource, driver, binding),
      ...(error.state === undefined ? {} : { state: error.state }),
      ...(error.observations === undefined ? {} : { observations: error.observations }),
      ...(error.deadlineMs === undefined ? {} : { deadline_ms: error.deadlineMs })
    });
  }
  if (error instanceof UnknownOutcomeError) {
    const resource = error.resource ? toWire(error.resource, driver, binding) : best;
    return errorAnswer(runtime, {
      code: "unknown",
      reason: error instanceof BridgeUnknownError ? error.reason : "reply_lost",
      effect: "unknown",
      ...(resource ? { resource } : {})
    });
  }
  const effects = partialEffectsOf(error);
  if ((error instanceof PartialEffectsError || error instanceof CleanupFailureError) && effects) {
    const resources = effects.resources.map((entry) => toWire(entry, driver, binding));
    const resource = resources[0] ?? best;
    if (resource) {
      const cleanup: CleanupReport = {
        status: effects.cleanup.status,
        residual: (effects.cleanup.residual ?? []).map((entry) => toWire(entry, driver, binding))
      };
      return errorAnswer(runtime, { code: "provider_failed", reason: "provider_refused", effect: "applied", resource, cleanup });
    }
    return errorAnswer(runtime, { code: "unknown", reason: "reply_lost", effect: "unknown" });
  }
  if (error instanceof PolicyViolationError) {
    // The facade's own check refused after the worker's checks passed. Still before any effect.
    return errorAnswer(runtime, { code: "denied", reason: "policy_denied", effect: "none" });
  }
  if (error instanceof UnsupportedCapabilityError) {
    return errorAnswer(runtime, { code: "unsupported", reason: "action", effect: "none" });
  }
  if (error instanceof AdapterExecutionError) {
    diagnostic(`provider failure: ${error.message}`);
    return errorAnswer(runtime, { code: "provider_failed", reason: providerReason(error), effect: "none" });
  }
  // Not a Capsule outcome type: the worker cannot tell whether the provider applied the action.
  diagnostic(`unexpected failure after dispatch: ${error instanceof Error ? error.message : String(error)}`);
  return errorAnswer(runtime, { code: "unknown", reason: "reply_lost", effect: "unknown", ...(best ? { resource: best } : {}) });
}

function providerReason(error: AdapterExecutionError): "provider_refused" | "not_found" | "quota" {
  const cause = error.cause as { providerError?: { category?: string; code?: string; status?: number } } | undefined;
  const classified = cause?.providerError;
  if (classified?.category === "rate-limit") return "quota";
  if (classified?.status === 404 || classified?.code === "not_found" || /no such|not found/i.test(error.message)) return "not_found";
  return "provider_refused";
}

interface Prepared {
  binding: Record<string, string>;
  grant?: CapsuleApprovalGrant;
  secretEnv: Record<string, string>;
  facadePolicy: CapsulePolicy;
}

/** Locator scope, owner, policy and approval checks. Throws Refusal; makes provider reads only. */
async function prepare(context: DispatchContext, runtime: OperationRuntime, request: BridgeRequest, binding: Record<string, string>): Promise<Prepared> {
  const { driver, config } = context;
  const capability = actionCapability(driver.profile, request.action)!;
  if ("target" in request) {
    const state: ResourceState = await guarded(runtime, driver.read(request.target.native_id));
    if (!state.exists) throw new Refusal("provider_failed", "not_found", "the target does not exist in this scope");
    if (state.owner?.job !== request.scope.job) throw new Refusal("denied", "owner_mismatch", "the target was not created by this job");
  }
  if (request.action === "sandbox.create" && config.policy.images !== undefined && !config.policy.images.includes(request.params.image)) {
    throw new Refusal("denied", "policy_denied", "the image is not allowed by policy");
  }
  const secretNames = "secret_names" in request.params ? request.params.secret_names : [];
  const secretEnv: Record<string, string> = {};
  if (secretNames.length > 0) {
    if (!capability.secrets) throw new Refusal("denied", "secret_not_allowed", "this action takes no secrets");
    // A present block with omitted allowed denies all; two blocks intersect; an absent block adds nothing.
    const merged = mergePolicy({ ...(config.policy.secrets ? { secrets: config.policy.secrets } : {}) }, request.policy ?? {}).secrets;
    if (merged) {
      const allowed = new Set(merged.allowed ?? []);
      if (secretNames.some((name) => !allowed.has(name))) throw new Refusal("denied", "secret_not_allowed", "a secret name is not allowed");
    }
    for (const name of secretNames) {
      const value = driver.secret(name);
      if (value === undefined) throw new Refusal("denied", "secret_not_allowed", "a secret is not available to the worker");
      secretEnv[name] = value;
    }
  }
  let grant: CapsuleApprovalGrant | undefined;
  if (request.approval !== null) {
    grant = resolveApproval(
      config,
      request.approval.ref,
      request.action,
      driver.profile.provider,
      "target" in request ? request.target.native_id : undefined,
      driver.now()
    );
  } else if (capability.approval === "required") {
    throw new Refusal("denied", "approval_required", "this action needs a fresh approval");
  }
  const plainEnvKeys = request.action === "sandbox.create" ? Object.keys(request.params.env) : [];
  const facadePolicy: CapsulePolicy = {
    ...(grant || capability.approval === "required" ? { approvals: { required: true, reason: `bridge ${request.action}` } } : {}),
    ...(secretNames.length > 0 ? { secrets: { allowed: [...plainEnvKeys, ...secretNames], redactFromLogs: true } } : {})
  };
  return { binding, ...(grant ? { grant } : {}), secretEnv, facadePolicy };
}

/** Runs one request to its answer. Every refusal comes back before any provider effect. */
export async function dispatchRequest(context: DispatchContext, runtime: OperationRuntime, request: BridgeRequest): Promise<Answer> {
  const { driver, idempotency } = context;
  let binding: Record<string, string>;
  try {
    binding = await guarded(runtime, driver.binding());
  } catch (error) {
    if (error instanceof DrainInterrupt) return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
    context.diagnostic(`binding failed: ${error instanceof Error ? error.message : String(error)}`);
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("provider_failed", "provider_refused"));
  }
  if ("target" in request && !sameScope(request.target.scope, binding)) {
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("denied", "scope_mismatch", "the target is outside this worker's scope"));
  }
  const key = request.operation.key;
  const prior = idempotency.get(key);
  if (prior) {
    if (prior.answer === undefined || prior.digest !== request.operation.digest) {
      return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("invalid", "idempotency_conflict"));
    }
    return { ...prior.answer, request_id: runtime.requestId, operation_id: runtime.operationId, ...(prior.answer.type === "result" ? { replayed: true } : {}) };
  }
  idempotency.begin(key, request.operation.digest);
  let prepared: Prepared;
  try {
    prepared = await prepare(context, runtime, request, binding);
  } catch (error) {
    idempotency.abandon(key);
    if (error instanceof Refusal) return refusalAnswer(runtime.requestId, runtime.operationId, error);
    if (error instanceof DrainInterrupt) return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
    context.diagnostic(`check failed before dispatch: ${error instanceof Error ? error.message : String(error)}`);
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("provider_failed", "provider_refused"));
  }
  if (runtime.drained.aborted) {
    idempotency.abandon(key);
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
  }
  const evidence = new OperationEvidence(driver.receipts?.store, driver.receipts?.durable ?? false);
  try {
    // A receipt store that cannot take writes is found out before the effect, not after it.
    await guarded(runtime, evidence.ready());
  } catch (error) {
    idempotency.abandon(key);
    if (error instanceof DrainInterrupt) return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
    context.diagnostic(`receipt store not ready: ${error instanceof Error ? error.message : String(error)}`);
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("provider_failed", "provider_refused"));
  }
  const answer = await dispatchChecked(context, runtime, request, prepared, evidence);
  idempotency.finish(key, answer);
  return answer;
}

async function dispatchChecked(
  context: DispatchContext,
  runtime: OperationRuntime,
  request: BridgeRequest,
  prepared: Prepared,
  evidence: OperationEvidence
): Promise<Answer> {
  const { driver } = context;
  const { binding } = prepared;
  const hooks: OperationHooks = {
    cancel: runtime.cancel,
    onRunning: (state) => {
      if ("target" in request) runtime.progress(state, request.target);
    }
  };
  const capsule = new Capsule({
    adapter: driver.adapter(hooks),
    policy: prepared.facadePolicy,
    receipts: true,
    receiptStore: evidence,
    receiptPersistence: "required"
  });
  const target = "target" in request ? request.target : undefined;
  let best: WireLocator | undefined = target;
  try {
    if (request.action === "sandbox.create") {
      const existing = await guarded(runtime, driver.findCreated(request.operation.id, request.operation.key));
      if (existing !== undefined) {
        // The profile's dedupe found what an earlier attempt of this operation created: no new call.
        // It is reused only when this job created it; another job's resource is never claimed.
        const state = await guarded(runtime, driver.read(existing));
        if (state.exists && state.owner?.job !== request.scope.job) {
          throw new Refusal("denied", "owner_mismatch", "the deduplicated resource belongs to another job");
        }
        const resource = wireLocator(existing, driver, binding);
        await observeTerminalOf(context, runtime, "sandbox.create", resource, request.deadline_ms);
        return result(runtime, "completed", resource, { status: "ready" }, undefined, true);
      }
      const sandbox = await guarded(
        runtime,
        capsule.sandbox.create({
          image: request.params.image,
          name: driver.resourceName(request.operation.id, request.operation.key),
          env: { ...request.params.env, ...prepared.secretEnv },
          ...(prepared.grant ? { approval: prepared.grant } : {}),
          idempotencyKey: request.operation.key,
          timeoutMs: request.deadline_ms,
          labels: {
            ...request.params.labels,
            "fabric.operation": request.operation.id,
            "fabric.job": request.scope.job,
            "fabric.attempt": request.scope.attempt,
            "fabric.generation": request.scope.generation
          }
        })
      );
      const resource = wireLocator(sandbox.handle.id, driver, binding);
      best = resource;
      await observeTerminalOf(context, runtime, "sandbox.create", resource, request.deadline_ms);
      return result(runtime, "completed", resource, { status: "ready" }, evidence);
    }
    const resource = target!;
    const sandbox = await guarded(runtime, capsule.sandbox.attach({ id: resource.native_id }));
    if (request.action === "sandbox.destroy") {
      await guarded(runtime, sandbox.destroy(prepared.grant ? { approval: prepared.grant } : {}));
      await observeTerminalOf(context, runtime, "sandbox.destroy", resource, request.deadline_ms);
      return result(runtime, "completed", resource, { status: "destroyed" }, evidence);
    }
    const params = request.params;
    const exec = sandbox.exec({
      command: params.argv,
      ...(params.cwd === null ? {} : { cwd: params.cwd }),
      ...(params.stdin === null ? {} : { input: params.stdin }),
      timeoutMs: params.timeout_ms,
      ...(Object.keys(prepared.secretEnv).length > 0 ? { env: prepared.secretEnv } : {}),
      ...(prepared.grant ? { approval: prepared.grant } : {}),
      idempotencyKey: request.operation.key,
      bounds: { maxBytes: params.max_output_bytes }
    });
    const outcome = await guarded(runtime, withDeadline(runtime, exec, request.deadline_ms, driver));
    if (outcome === "deadline") {
      // Not terminal-only: answer what is known, a running command, and leave it running.
      return result(runtime, "running", resource, { exit_code: null, stdout: emptyStream, stderr: emptyStream }, evidence);
    }
    return result(runtime, "completed", resource, execOutput(outcome), evidence);
  } catch (error) {
    if (error instanceof ExecCancelledError) {
      return result(runtime, "cancelled", target!, { exit_code: null, stdout: emptyStream, stderr: emptyStream }, evidence);
    }
    if (error instanceof DrainInterrupt) {
      // The shutdown drain ended while the provider call was in flight: say what is known, invent nothing.
      if (best) {
        return errorAnswer(runtime, {
          code: "pending",
          reason: "shutting_down",
          effect: "pending",
          resource: best,
          ...(request.action === "sandbox.exec" ? { state: "running" } : {}),
          deadline_ms: request.deadline_ms
        });
      }
      return errorAnswer(runtime, { code: "unknown", reason: "reply_lost", effect: "unknown" });
    }
    return outcomeAnswer(runtime, error, driver, binding, best, context.diagnostic);
  }
}

/** Races an exec with the request deadline on the profile's clock. Virtual time never runs out by itself. */
function withDeadline(runtime: OperationRuntime, exec: Promise<ExecResult>, deadlineMs: number, driver: BridgeDriver): Promise<ExecResult | "deadline"> {
  if (driver.clock.kind === "virtual") return exec;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("deadline"), deadlineMs);
    exec.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
    runtime.drained.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
}

async function observeTerminalOf(context: DispatchContext, runtime: OperationRuntime, action: BridgeAction, resource: WireLocator, budgetMs: number) {
  const { driver } = context;
  return observeUntilTerminal({
    timer: runtime.timer,
    intervalMs: driver.profile.observe_interval_ms,
    budgetMs,
    drainAt: () => runtime.drainAt(),
    operation: action,
    resource: coreLocator(resource),
    read: async () => driver.terminal(action, await driver.read(resource.native_id))
  });
}

/** Runs one observe to its answer. It makes no mutating call and needs no approval. */
export async function dispatchObserve(context: DispatchContext, runtime: OperationRuntime, observe: Observe): Promise<Answer> {
  const { driver } = context;
  let binding: Record<string, string>;
  try {
    binding = await guarded(runtime, driver.binding());
  } catch {
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
  }
  if (!sameScope(observe.resource.scope, binding)) {
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("denied", "scope_mismatch", "the resource is outside this worker's scope"));
  }
  const resource = observe.resource;
  try {
    if (observe.action === "sandbox.create") {
      // A create that never happened has nothing to observe: report it as a definite not found.
      const state = await driver.read(resource.native_id);
      if (!state.exists) return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("provider_failed", "not_found"));
    }
    await observeUntilTerminal({
      timer: runtime.timer,
      intervalMs: driver.profile.observe_interval_ms,
      budgetMs: observe.wait_ms,
      drainAt: () => runtime.drainAt(),
      operation: observe.action,
      resource: coreLocator(resource),
      read: async () => driver.terminal(observe.action, await driver.read(resource.native_id))
    });
    return result(runtime, "completed", resource, observe.action === "sandbox.destroy" ? { status: "destroyed" } : { status: "ready" });
  } catch (error) {
    if (error instanceof PendingOperationError || error instanceof UnknownOutcomeError) {
      return outcomeAnswer(runtime, error, driver, binding, resource, context.diagnostic);
    }
    return errorAnswer(runtime, { code: "unknown", reason: "observation_failed", effect: "unknown", resource });
  }
}
