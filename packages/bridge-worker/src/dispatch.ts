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
import { resolveApproval, type ApprovalUses, type WorkerConfig } from "./config.js";
import type { BridgeDriver, OperationHooks, ResourceState } from "./driver.js";
import { ExecCancelledError } from "./fixture.js";
import {
  BridgeAbsentError,
  BridgePendingError,
  BridgeUnknownError,
  observeUntilTerminal,
  untilAborted,
  type ObservationStep,
  type OperationTimer,
  type PendingReason
} from "./observe.js";
import { actionCapability } from "./profiles.js";
import { Refusal } from "./validate.js";
import type {
  Attach,
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
  Searched,
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

/** Interrupts an await when the request's deadline_ms (an observe's wait_ms) has passed on a wall clock. */
class DeadlineInterrupt extends Error {
  constructor() {
    super("deadline_ms passed");
    this.name = "DeadlineInterrupt";
  }
}

/** Interrupts the wait for an exec when the provider has accepted it and runs it on its own. */
class DetachInterrupt extends Error {
  constructor() {
    super("the provider runs the exec on");
    this.name = "DetachInterrupt";
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
  /** Aborted when deadline_ms (wait_ms for an observe or an attach) has passed since the frame was read. Never on a virtual clock. */
  readonly deadline: AbortSignal;
  /** Drain end in the timer's time; undefined while not draining. */
  drainAt(): number | undefined;
  /** Reports provider progress; the session decides whether to send it. */
  progress(state: string, resource: WireLocator): void;
  /**
   * Provider work that goes on after its answer, such as an exec answered running. It keeps counting
   * against max_in_flight until it settles, so answered work cannot pile up past the limit.
   */
  linger(work: Promise<unknown>): void;
}

export type Answer = Result | ErrorMessage;

interface StoredAnswer {
  digest: string;
  /** Undefined while the first request is in flight, and after the answer was dropped for memory. */
  answer?: Answer;
  answered: boolean;
}

/** Characters of output text an answer holds, plus a fixed allowance for the rest of it. */
function heldSize(answer: Answer): number {
  if (answer.type !== "result" || !("stdout" in answer.output)) return 256;
  return 256 + answer.output.stdout.text.length + answer.output.stderr.text.length;
}

/**
 * Answers per operation key, per connection and bounded twice: by key count, and by the output text
 * the held answers carry, since one exec answer can hold two streams of max_output_bytes each. Past
 * the text budget the oldest answers are dropped but their key and digest stay, so a repeat is
 * refused as a conflict and never runs the action again. The table does not survive the worker.
 */
export class IdempotencyTable {
  private readonly entries = new Map<string, StoredAnswer>();
  /** Keys whose answer is held, oldest first, with the size counted for each. */
  private readonly held = new Map<string, number>();
  private heldTotal = 0;

  constructor(
    private readonly capacity = 4096,
    private readonly textBudget = 16 << 20
  ) {}

  /** Output text characters the held answers carry; at most the budget. */
  get heldChars(): number {
    return this.heldTotal;
  }

  get(key: string): StoredAnswer | undefined {
    return this.entries.get(key);
  }

  begin(key: string, digest: string): void {
    this.entries.set(key, { digest, answered: false });
  }

  abandon(key: string): void {
    this.entries.delete(key);
  }

  finish(key: string, answer: Answer): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.answer = answer;
    entry.answered = true;
    const size = heldSize(answer);
    this.held.set(key, size);
    this.heldTotal += size;
    for (const [oldest, oldestSize] of this.held) {
      if (this.heldTotal <= this.textBudget) break;
      this.release(oldest, oldestSize);
      delete this.entries.get(oldest)!.answer;
    }
    if (this.entries.size <= this.capacity) return;
    // Evict the oldest answered key. Map iteration is insertion order, so this is usually the first entry.
    for (const [oldest, value] of this.entries) {
      if (value.answered) {
        this.entries.delete(oldest);
        const size = this.held.get(oldest);
        if (size !== undefined) this.release(oldest, size);
        return;
      }
    }
  }

  private release(key: string, size: number): void {
    this.held.delete(key);
    this.heldTotal -= size;
  }
}

/** One exec this worker sent to its provider, and its answer once the command ended. */
export interface ExecRecord {
  /** The native id of the sandbox the exec ran in. */
  readonly target: string;
  /** The job the exec belongs to. */
  readonly job: string;
  /** The exec's own answer once it ended: a completed or cancelled result, or an error. */
  done?: Answer;
}

/**
 * Every exec this worker sent to its provider, by operation id, so an observe can report how an exec
 * ended after its answer was `running` or was lost. Bounded twice, like the idempotency table: by
 * record count, and by the output text the ended records hold. Past either bound the oldest ended
 * record is dropped whole, and an observe of it answers unknown. A record in progress is never
 * dropped; there are at most max_in_flight of those. The ledger does not survive the worker, so an
 * exec another worker process ran is unknown here too.
 */
export class ExecLedger {
  private readonly records = new Map<string, ExecRecord>();
  /** Ended records, oldest first, with the size counted for each. */
  private readonly ended = new Map<string, number>();
  private endedTotal = 0;

  constructor(
    private readonly capacity = 1024,
    private readonly textBudget = 16 << 20
  ) {}

  /** Output text characters the ended records hold; at most the budget. */
  get heldChars(): number {
    return this.endedTotal;
  }

  get size(): number {
    return this.records.size;
  }

  get(operationId: string): ExecRecord | undefined {
    return this.records.get(operationId);
  }

  begin(operationId: string, target: string, job: string): ExecRecord {
    // An id seen before starts over: its ended record leaves the accounting, so eviction never
    // reaches the new record while it runs.
    const size = this.ended.get(operationId);
    if (size !== undefined) {
      this.ended.delete(operationId);
      this.endedTotal -= size;
    }
    const record: ExecRecord = { target, job };
    this.records.set(operationId, record);
    return record;
  }

  finish(operationId: string, record: ExecRecord, answer: Answer): void {
    record.done = answer;
    // A record dropped while its exec ran is not brought back.
    if (this.records.get(operationId) !== record) return;
    const size = heldSize(answer);
    this.ended.set(operationId, size);
    this.endedTotal += size;
    for (const [oldest, oldestSize] of this.ended) {
      if (this.endedTotal <= this.textBudget && this.records.size <= this.capacity) break;
      this.ended.delete(oldest);
      this.endedTotal -= oldestSize;
      this.records.delete(oldest);
    }
  }
}

/**
 * The resources an observe read as absent, by native id, each with the scope searched. A later destroy
 * that the provider answers not_found carries this evidence, so Fabric can settle it; without it a
 * not_found says only that the worker looked once, now. Bounded: the oldest entry goes first.
 */
export class AbsentLedger {
  private readonly entries = new Map<string, Searched>();

  constructor(private readonly capacity = 1024) {}

  get(nativeId: string): Searched | undefined {
    return this.entries.get(nativeId);
  }

  record(nativeId: string, searched: Searched): void {
    this.entries.delete(nativeId);
    this.entries.set(nativeId, searched);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value as string);
  }

  /** A resource read as present is not absent; what was recorded before no longer describes it. */
  forget(nativeId: string): void {
    this.entries.delete(nativeId);
  }
}

export interface DispatchContext {
  driver: BridgeDriver;
  config: WorkerConfig;
  idempotency: IdempotencyTable;
  execs: ExecLedger;
  /** Which operation each approval ref has resolved for; a ref is never resolved for a second one. */
  approvalUses: ApprovalUses;
  absent: AbsentLedger;
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

/** Awaits provider work until it settles, the drain ends (DrainInterrupt) or the deadline passes (DeadlineInterrupt). */
function guarded<T>(runtime: OperationRuntime, promise: Promise<T>): Promise<T> {
  return untilAborted(promise, [
    [runtime.drained, () => new DrainInterrupt()],
    [runtime.deadline, () => new DeadlineInterrupt()]
  ]);
}

/** Observation reads are interrupted only on a wall clock; on the virtual clock the loop's own bounds decide. */
function readInterrupts(runtime: OperationRuntime, driver: BridgeDriver): { interrupts?: { deadline: AbortSignal; drained: AbortSignal } } {
  return driver.clock.kind === "wall" ? { interrupts: { deadline: runtime.deadline, drained: runtime.drained } } : {};
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

/** Where this worker looks: the profile's provider, its bound scope and the profile's resource kind. */
function searchedScope(driver: BridgeDriver, binding: Record<string, string>): Searched {
  return { provider: driver.profile.provider, scope: { ...binding }, kind: driver.profile.resource_kinds[0]! };
}

/**
 * A destroy the provider answered not_found settles nothing by itself. Once an observe of that resource
 * has answered absent, the destroy's answer carries the scope that observe searched, and Fabric settles
 * the destroy on that evidence. Decided 2026-11-02 under Efe's delegation of that day (Fabric M4).
 */
function withAbsentEvidence(context: DispatchContext, request: BridgeRequest, answer: Answer): Answer {
  if (request.action !== "sandbox.destroy" || answer.type !== "error") return answer;
  const { error } = answer;
  if (error.code !== "provider_failed" || error.reason !== "not_found" || error.searched) return answer;
  const searched = context.absent.get(request.target.native_id);
  return searched ? { ...answer, error: { ...error, searched } } : answer;
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
  if (error instanceof BridgeAbsentError) {
    // Nothing carried the operation's identity: no resource, and the scope searched instead.
    return errorAnswer(runtime, {
      code: "unknown",
      reason: "absent",
      effect: "unknown",
      observations: error.observations,
      deadline_ms: error.deadlineMs,
      searched: error.searched
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
    // Under Capsule's adapter contract this is a definite failure: an adapter reports a timeout or a
    // lost reply as UnknownOutcomeError (handled above), never as a plain AdapterExecutionError.
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
  const refused = driver.admit?.(request);
  if (refused) throw refused;
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
      driver.now(),
      request.operation.id,
      context.approvalUses
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
    // A first request still in flight, or one whose answer was dropped for memory, has no answer to
    // replay; either way the action never runs a second time.
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
    if (error instanceof Refusal) return withAbsentEvidence(context, request, refusalAnswer(runtime.requestId, runtime.operationId, error));
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
  const answer = withAbsentEvidence(context, request, await dispatchChecked(context, runtime, request, prepared, evidence));
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
  const detached = new AbortController();
  const hooks: OperationHooks = {
    operation: { id: request.operation.id, key: request.operation.key },
    cancel: runtime.cancel,
    onRunning: (state) => {
      if ("target" in request) runtime.progress(state, request.target);
    },
    detach: () => detached.abort()
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
  // What an interrupt means depends on how far the request got: during "checks" nothing was sent to
  // the provider; during "effect" a mutating call was sent and has not answered; during "observe"
  // the call answered and the bounded observation reports pending by itself.
  let phase: "checks" | "effect" | "observe" = "checks";
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
        phase = "observe";
        await observeTerminalOf(context, runtime, "sandbox.create", resource, request.deadline_ms);
        return result(runtime, "completed", resource, { status: "ready" }, undefined, true);
      }
      const name = driver.resourceName(request.operation.id, request.operation.key);
      // Until the provider returns an id, the best locator is the name this create asked for: the
      // provider resolves it, and the resource carries this operation's label for an observe to check.
      best = wireLocator(name, driver, binding);
      startEffect(runtime);
      phase = "effect";
      const creating = capsule.sandbox.create({
        image: request.params.image,
        name,
        env: { ...request.params.env, ...prepared.secretEnv },
        ...(prepared.grant ? { approval: prepared.grant } : {}),
        idempotencyKey: request.operation.key,
        timeoutMs: request.deadline_ms,
        // The worker's own labels come last, so a request label can never claim another owner.
        labels: {
          ...request.params.labels,
          "fabric.operation": request.operation.id,
          "fabric.job": request.scope.job,
          "fabric.attempt": request.scope.attempt,
          "fabric.generation": request.scope.generation
        }
      });
      const sandbox = await lingering(runtime, creating);
      const resource = wireLocator(sandbox.handle.id, driver, binding);
      best = resource;
      phase = "observe";
      await observeTerminalOf(context, runtime, "sandbox.create", resource, request.deadline_ms);
      return result(runtime, "completed", resource, { status: "ready" }, evidence);
    }
    const resource = target!;
    const sandbox = await guarded(runtime, capsule.sandbox.attach({ id: resource.native_id }));
    if (request.action === "sandbox.destroy") {
      startEffect(runtime);
      phase = "effect";
      await lingering(runtime, sandbox.destroy(prepared.grant ? { approval: prepared.grant } : {}));
      phase = "observe";
      await observeTerminalOf(context, runtime, "sandbox.destroy", resource, request.deadline_ms);
      return result(runtime, "completed", resource, { status: "destroyed" }, evidence);
    }
    const params = request.params;
    startEffect(runtime);
    phase = "effect";
    // The ledger holds the exec from the moment it is sent, so an observe by the operation id can
    // report how it ended even when this request's answer was `running` or never reached Fabric.
    const record = context.execs.begin(request.operation.id, resource.native_id, request.scope.job);
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
    const ended: Promise<Answer> = exec.then(
      (output) => result(runtime, "completed", resource, execOutput(output), evidence),
      (error: unknown) =>
        error instanceof ExecCancelledError
          ? result(runtime, "cancelled", resource, { exit_code: null, stdout: emptyStream, stderr: emptyStream }, evidence)
          : outcomeAnswer(runtime, error, driver, binding, resource, context.diagnostic)
    );
    void ended.then((answer) => context.execs.finish(request.operation.id, record, answer));
    try {
      return await untilAborted(ended, [
        [runtime.drained, () => new DrainInterrupt()],
        [runtime.deadline, () => new DeadlineInterrupt()],
        [detached.signal, () => new DetachInterrupt()]
      ]);
    } catch (error) {
      if (!(error instanceof DeadlineInterrupt || error instanceof DetachInterrupt)) throw error;
      // Not terminal-only: answer what is known, a running command, and leave it running. It still
      // holds its in-flight slot until it ends, and an observe of the operation reports its end.
      runtime.linger(exec);
      return result(runtime, "running", resource, { exit_code: null, stdout: emptyStream, stderr: emptyStream }, evidence);
    }
  } catch (error) {
    if (error instanceof ExecCancelledError) {
      return result(runtime, "cancelled", target!, { exit_code: null, stdout: emptyStream, stderr: emptyStream }, evidence);
    }
    if (error instanceof DrainInterrupt || error instanceof DeadlineInterrupt) {
      return interrupted(runtime, request, phase, error, best);
    }
    if (phase === "checks" && !(error instanceof Refusal) && !(error instanceof AdapterExecutionError)) {
      // A read before the effect failed, for example an engine that cannot be reached: nothing was sent.
      context.diagnostic(`check failed before dispatch: ${error instanceof Error ? error.message : String(error)}`);
      return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("provider_failed", "provider_refused"));
    }
    return outcomeAnswer(runtime, error, driver, binding, best, context.diagnostic);
  }
}

/** The last check before a mutating call: a drain or deadline that already ended stops the request here, before any effect. */
function startEffect(runtime: OperationRuntime): void {
  if (runtime.drained.aborted) throw new DrainInterrupt();
  if (runtime.deadline.aborted) throw new DeadlineInterrupt();
}

/** Awaits a mutating provider call; if the wait is interrupted the call goes on and keeps its in-flight slot. */
async function lingering<T>(runtime: OperationRuntime, call: Promise<T>): Promise<T> {
  try {
    return await guarded(runtime, call);
  } catch (error) {
    if (error instanceof DrainInterrupt || error instanceof DeadlineInterrupt) runtime.linger(call);
    throw error;
  }
}

/** The answer when a drain or the deadline ends a wait: say what is known, invent nothing. */
function interrupted(
  runtime: OperationRuntime,
  request: BridgeRequest,
  phase: "checks" | "effect" | "observe",
  error: DrainInterrupt | DeadlineInterrupt,
  best: WireLocator | undefined
): Answer {
  const drain = error instanceof DrainInterrupt;
  if (phase === "checks") {
    // Only reads ran, and nothing was sent to the provider: a refusal before effect.
    const refusal = drain
      ? new Refusal("unavailable", "shutting_down")
      : new Refusal("provider_failed", "provider_refused", "the checks did not finish within deadline_ms");
    return refusalAnswer(runtime.requestId, runtime.operationId, refusal);
  }
  if (drain && request.action !== "sandbox.create" && best) {
    return errorAnswer(runtime, {
      code: "pending",
      reason: "shutting_down",
      effect: "pending",
      resource: best,
      ...(request.action === "sandbox.exec" ? { state: "running" } : {}),
      deadline_ms: request.deadline_ms
    });
  }
  // The call was sent and has not answered: whether the provider applied it cannot be told yet.
  return errorAnswer(runtime, { code: "unknown", reason: "reply_lost", effect: "unknown", ...(best ? { resource: best } : {}) });
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
    read: async () => driver.terminal(action, await driver.read(resource.native_id)),
    ...readInterrupts(runtime, driver)
  });
}

/** Runs one observe to its answer. It makes no mutating call and needs no approval. */
export async function dispatchObserve(context: DispatchContext, runtime: OperationRuntime, observe: Observe): Promise<Answer> {
  const { driver } = context;
  let binding: Record<string, string>;
  try {
    binding = await guarded(runtime, driver.binding());
  } catch (error) {
    if (error instanceof DrainInterrupt) return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
    // Nothing was read: a refused observe, which changes nothing in Fabric's journal.
    context.diagnostic(`binding failed: ${error instanceof Error ? error.message : String(error)}`);
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("provider_failed", "provider_refused"));
  }
  if (!sameScope(observe.resource.scope, binding)) {
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("denied", "scope_mismatch", "the resource is outside this worker's scope"));
  }
  const resource = observe.resource;
  try {
    // Who made the resource is settled before anything about it is reported. The worker labels what
    // it creates with the creating operation and its job, and the observe names the original
    // operation's scope. A resource another job made, or no job, is refused for every action. A create
    // is answered only when the resource's operation label is the observing operation. A destroy's or
    // an exec's own id is on no resource label, so the job label is their check, and an exec's ledger
    // record adds its own.
    const state = await guarded(runtime, driver.read(resource.native_id));
    if (state.exists) context.absent.forget(resource.native_id);
    else context.absent.record(resource.native_id, searchedScope(driver, binding));
    if (observe.action === "sandbox.create" && !state.exists) {
      // A create that never happened has nothing to observe: a definite not found, naming the scope
      // searched so Fabric holds it as absent evidence.
      return errorAnswer(runtime, { code: "provider_failed", reason: "not_found", effect: "none", searched: searchedScope(driver, binding) });
    }
    if (state.exists && state.owner?.job !== observe.scope.job) {
      return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("denied", "owner_mismatch", "the resource was not created by this job"));
    }
    if (state.exists && observe.action === "sandbox.create" && state.owner?.operation !== observe.operation_id) {
      return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("denied", "owner_mismatch", "the resource was not created by this operation"));
    }
    if (observe.action === "sandbox.exec") return await observeExec(context, runtime, observe);
    await observeUntilTerminal({
      timer: runtime.timer,
      intervalMs: driver.profile.observe_interval_ms,
      budgetMs: observe.wait_ms,
      drainAt: () => runtime.drainAt(),
      operation: observe.action,
      resource: coreLocator(resource),
      read: async () => driver.terminal(observe.action, await driver.read(resource.native_id)),
      ...readInterrupts(runtime, driver)
    });
    return result(runtime, "completed", resource, observe.action === "sandbox.destroy" ? { status: "destroyed" } : { status: "ready" });
  } catch (error) {
    if (error instanceof DrainInterrupt || error instanceof DeadlineInterrupt) {
      // The drain or wait_ms ended before the first read answered: nothing was observed.
      const pending = new BridgePendingError(error instanceof DrainInterrupt ? "shutting_down" : "observation_deadline", {
        operation: observe.action,
        resource: coreLocator(resource),
        deadlineMs: observe.wait_ms,
        observations: 0
      });
      return outcomeAnswer(runtime, pending, driver, binding, resource, context.diagnostic);
    }
    if (error instanceof PendingOperationError || error instanceof UnknownOutcomeError) {
      return outcomeAnswer(runtime, error, driver, binding, resource, context.diagnostic);
    }
    return errorAnswer(runtime, { code: "unknown", reason: "observation_failed", effect: "unknown", resource });
  }
}

/**
 * Observes an exec through the ledger: how the command this worker sent ended, waiting at most wait_ms
 * for one still running. An exec the ledger does not hold is unknown, never run again: another worker
 * process ran it, or the record was dropped for memory.
 */
async function observeExec(context: DispatchContext, runtime: OperationRuntime, observe: Observe): Promise<Answer> {
  const { driver } = context;
  const resource = observe.resource;
  const record = context.execs.get(observe.operation_id);
  if (!record) return errorAnswer(runtime, { code: "unknown", reason: "observation_failed", effect: "unknown", resource });
  if (record.target !== resource.native_id || record.job !== observe.scope.job) {
    return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("denied", "owner_mismatch", "the exec is not this job's exec on this resource"));
  }
  if (!record.done) {
    await observeUntilTerminal({
      timer: runtime.timer,
      intervalMs: driver.profile.observe_interval_ms,
      budgetMs: observe.wait_ms,
      drainAt: () => runtime.drainAt(),
      operation: observe.action,
      resource: coreLocator(resource),
      initialState: "running",
      read: async () => (record.done ? { terminal: true } : { terminal: false, state: "running" }),
      ...readInterrupts(runtime, driver)
    });
  }
  // The exec's own answer, addressed to this observe. A result reports the exec's end; it is not a replay.
  const done = record.done!;
  return done.type === "result"
    ? { ...done, request_id: runtime.requestId, operation_id: runtime.operationId, replayed: false }
    : { ...done, request_id: runtime.requestId, operation_id: runtime.operationId };
}

/**
 * Runs one attach to its answer: finds what an earlier create of this operation made, by the
 * operation's identity under the profile's dedupe (driver.findCreated), checks who made it, then reads
 * its state as an observe of the create does. It makes no mutating call, needs no approval and never
 * creates, so a create whose answer was lost is found, not made again. Looks run at elapsed 0, then
 * every observe_interval_ms while below wait_ms and the drain's end; `observations` counts the looks
 * that finished. Nothing found is `absent` with the scope searched, which settles nothing.
 */
export async function dispatchAttach(context: DispatchContext, runtime: OperationRuntime, attach: Attach): Promise<Answer> {
  const { driver } = context;
  let binding: Record<string, string>;
  try {
    binding = await guarded(runtime, driver.binding());
  } catch (error) {
    if (error instanceof DrainInterrupt) return refusalAnswer(runtime.requestId, runtime.operationId, new Refusal("unavailable", "shutting_down"));
    // Without the bound scope there is nowhere to look and no scope to name. An attach makes no effect
    // that could fail, so this is a failed look, never provider_failed.
    if (!(error instanceof DeadlineInterrupt)) context.diagnostic(`binding failed: ${error instanceof Error ? error.message : String(error)}`);
    return errorAnswer(runtime, { code: "unknown", reason: "observation_failed", effect: "unknown" });
  }
  const searched = searchedScope(driver, binding);
  // Reads are interrupted only on a wall clock, as for an observe; on the virtual clock the loop's bounds decide.
  const look = <T>(work: Promise<T>): Promise<T> => (driver.clock.kind === "wall" ? guarded(runtime, work) : work);
  const { timer } = runtime;
  let found: WireLocator | undefined;
  let state: string | undefined;
  let observations = 0;
  const unfinished = (reason: PendingReason): Answer => {
    const outcome = found
      ? new BridgePendingError(reason, {
          operation: attach.action,
          resource: coreLocator(found),
          ...(state === undefined ? {} : { state }),
          deadlineMs: attach.wait_ms,
          observations
        })
      : new BridgeAbsentError({ operation: attach.action, searched, observations, deadlineMs: attach.wait_ms });
    return outcomeAnswer(runtime, outcome, driver, binding, found, context.diagnostic);
  };
  while (true) {
    const now = timer.elapsed();
    const drainAt = runtime.drainAt();
    if (drainAt !== undefined && now >= drainAt) return unfinished("shutting_down");
    if (now >= attach.wait_ms) return unfinished("observation_deadline");
    let step: ObservationStep;
    try {
      if (found) {
        step = driver.terminal(attach.action, await look(driver.read(found.native_id)));
      } else {
        const nativeId = await look(driver.findCreated(attach.operation_id, attach.key));
        const read = nativeId === undefined ? undefined : await look(driver.read(nativeId));
        if (nativeId === undefined || !read?.exists) {
          // Nothing made by this operation, or it is gone already: a destroyed resource is not found.
          step = { terminal: false };
        } else {
          // Who made it is settled before anything about it is reported, as for an observe of a create.
          if (read.owner?.job !== attach.scope.job || read.owner?.operation !== attach.operation_id) {
            return refusalAnswer(
              runtime.requestId,
              runtime.operationId,
              new Refusal("denied", "owner_mismatch", "the resource was not created by this operation")
            );
          }
          found = wireLocator(nativeId, driver, binding);
          step = driver.terminal(attach.action, read);
        }
      }
    } catch (error) {
      if (error instanceof DrainInterrupt) return unfinished("shutting_down");
      if (error instanceof DeadlineInterrupt) return unfinished("observation_deadline");
      context.diagnostic(`attach read failed: ${error instanceof Error ? error.message : String(error)}`);
      return errorAnswer(runtime, { code: "unknown", reason: "observation_failed", effect: "unknown", ...(found ? { resource: found } : {}) });
    }
    observations += 1;
    if (found && step.terminal) return result(runtime, "completed", found, { status: "ready" });
    if (found && !step.terminal && step.state !== undefined) state = step.state;
    const left = Math.min(attach.wait_ms, runtime.drainAt() ?? Number.POSITIVE_INFINITY) - timer.elapsed();
    if (left > 0) await timer.sleep(Math.min(driver.profile.observe_interval_ms, left));
  }
}
