import { PendingOperationError, type ResourceLocator } from "./errors.js";

// Normalized machine lifecycle statuses (AWS-02, EDGE-08) -----------------------------------------
// The transitional values starting/stopping/destroying were already returned by machine lifecycle
// operations; machine.status now reports them too instead of collapsing them into stopped/deleted or
// failed. Adapters keep the provider-native state in result metadata.

export type MachineStatus = "creating" | "starting" | "running" | "stopping" | "stopped" | "destroying" | "failed" | "deleted";

export const machineStatuses: readonly MachineStatus[] = Object.freeze([
  "creating",
  "starting",
  "running",
  "stopping",
  "stopped",
  "destroying",
  "failed",
  "deleted"
]);

export type MachineTransitionalStatus = "creating" | "starting" | "stopping" | "destroying";

export const machineTransitionalStatuses: readonly MachineTransitionalStatus[] = Object.freeze(["creating", "starting", "stopping", "destroying"]);

/** True for statuses where the provider is still moving the machine between stable states. */
export function isTransitionalMachineStatus(status: string): status is MachineTransitionalStatus {
  return (machineTransitionalStatuses as readonly string[]).includes(status);
}

// Safe resource locators (CD-DELETE) ---------------------------------------------------------------

export interface ResourceLocatorInput {
  provider: string;
  kind: string;
  nativeId: string;
  scope?: Record<string, string | undefined>;
  nativeOperationId?: string;
}

const maxLocatorValueLength = 512;

/**
 * Builds a frozen ResourceLocator that is safe to put in errors, receipts and logs. Values are
 * sanitized rather than rejected so the helper never masks a primary error on a failure path:
 * URL userinfo, query strings and fragments are removed (they commonly carry tokens or SAS
 * signatures), control characters are dropped and values are capped at 512 characters. Scope entries
 * whose value is undefined or empty are omitted.
 */
export function resourceLocator(input: ResourceLocatorInput): ResourceLocator {
  const scopeEntries = Object.entries(input.scope ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => [safeLocatorValue(key), safeLocatorValue(value)] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  const nativeOperationId = input.nativeOperationId === undefined ? undefined : safeLocatorValue(input.nativeOperationId);
  return Object.freeze({
    provider: safeLocatorValue(input.provider),
    kind: safeLocatorValue(input.kind),
    nativeId: safeLocatorValue(input.nativeId),
    ...(scopeEntries.length === 0 ? {} : { scope: Object.freeze(Object.fromEntries(scopeEntries)) }),
    ...(nativeOperationId ? { nativeOperationId } : {})
  });
}

function safeLocatorValue(value: unknown): string {
  let text = typeof value === "string" ? value : String(value ?? "");
  text = text.replace(/[\u0000-\u001f\u007f]/g, "");
  text = stripUrlSecrets(text);
  return text.length > maxLocatorValueLength ? text.slice(0, maxLocatorValueLength) : text;
}

function stripUrlSecrets(text: string): string {
  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(text);
  if (!schemeMatch) {
    // Not an absolute URL; still drop a query string or fragment, which never identifies a resource.
    return text.replace(/[?#].*$/s, "");
  }
  const rest = text.slice(schemeMatch[0].length).replace(/[?#].*$/s, "");
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash);
  const at = authority.lastIndexOf("@");
  return `${schemeMatch[0]}${at === -1 ? authority : authority.slice(at + 1)}${path}`;
}

// Bounded observation (CD-DELETE) -----------------------------------------------------------------

/**
 * One observation of an accepted provider action.
 * - `{ done: true, value }`: the action reached a terminal state; `value` is returned.
 * - `{ done: false, state }`: still in progress; `state` is the provider-native state, if known.
 * - `{ done: "failed", error }`: the action reached a definitive failed state; `error` is thrown as is.
 */
export type ObservationStep<T> = { done: true; value: T } | { done: false; state?: string } | { done: "failed"; error: unknown };

export interface ObservationContext {
  /** 1-based observation number. */
  attempt: number;
  /** Aborted when the overall deadline expires or the caller signal aborts. Pass it to provider requests. */
  signal: AbortSignal;
  /** Milliseconds left before the overall deadline. */
  remainingMs: number;
}

export interface BoundedObservationOptions {
  /** Capability path of the observed action, for example "service.delete". */
  operation: string;
  resource: ResourceLocator;
  /** Overall client-side budget in milliseconds, including the time spent inside every observation. */
  deadlineMs: number;
  /** Delay between observations. Defaults to 1000ms and is capped by the remaining budget. */
  intervalMs?: number;
  /** Optional cap on the number of observations. */
  maxObservations?: number;
  /** Caller cancellation. Stops observing; the action is still reported as pending. */
  signal?: AbortSignal;
}

export const defaultObservationIntervalMs = 1_000;

/**
 * Observes an action the provider already accepted until it reaches a terminal state or the bound
 * expires. On expiry, caller abort or an observation error it throws PendingOperationError carrying the
 * locator and last observed state, because the action is known to be in flight but not finished. It
 * never invents a terminal value. Server-side wait parameters are separate from this client deadline.
 */
export async function observeUntilTerminal<T>(
  observe: (context: ObservationContext) => Promise<ObservationStep<T>>,
  options: BoundedObservationOptions
): Promise<T> {
  const deadlineMs = positiveFinite(options.deadlineMs, "deadlineMs");
  const intervalMs = options.intervalMs === undefined ? defaultObservationIntervalMs : nonNegativeFinite(options.intervalMs, "intervalMs");
  const maxObservations = options.maxObservations === undefined ? Number.POSITIVE_INFINITY : positiveInteger(options.maxObservations, "maxObservations");
  const deadlineAt = Date.now() + deadlineMs;
  let lastState: string | undefined;
  let attempt = 0;

  const pending = (reason: string, cause?: unknown): PendingOperationError =>
    new PendingOperationError(
      `${options.operation} for ${options.resource.kind} ${options.resource.nativeId} is still pending: ${reason}.`,
      {
        operation: options.operation,
        resource: options.resource,
        ...(lastState === undefined ? {} : { state: lastState }),
        deadlineMs,
        observations: attempt
      },
      cause
    );

  while (true) {
    if (options.signal?.aborted) throw pending("observation aborted by caller", options.signal.reason);
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw pending(`observation deadline of ${deadlineMs}ms expired`);
    if (attempt >= maxObservations) throw pending(`observation limit of ${maxObservations} reached`);
    attempt += 1;

    const bounded = boundedSignal(remainingMs, options.signal);
    let step: ObservationStep<T>;
    try {
      step = await Promise.race([observe({ attempt, signal: bounded.signal, remainingMs }), bounded.aborted]);
    } catch (error) {
      if (bounded.signal.aborted) {
        throw options.signal?.aborted
          ? pending("observation aborted by caller", options.signal.reason)
          : pending(`observation deadline of ${deadlineMs}ms expired`);
      }
      throw pending("observation failed", error);
    } finally {
      bounded.dispose();
    }

    if (step.done === true) return step.value;
    if (step.done === "failed") throw step.error;
    if (step.state !== undefined) lastState = step.state;

    const waitMs = Math.min(intervalMs, deadlineAt - Date.now());
    if (waitMs > 0) await abortableDelay(waitMs, options.signal);
  }
}

function boundedSignal(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; aborted: Promise<never>; dispose(): void } {
  const controller = new AbortController();
  let rejectAborted: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  aborted.catch(() => undefined);
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectAborted(reason);
  };
  const timer = setTimeout(() => abort(new Error("observation deadline expired")), timeoutMs);
  const onParentAbort = () => abort(parent?.reason);
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    aborted,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    }
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function positiveFinite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number of milliseconds.`);
  }
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number of milliseconds.`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
