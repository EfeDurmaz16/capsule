import { PendingOperationError, UnknownOutcomeError, type ResourceLocator } from "@capsule-sdk/core";

// Bounded observation of an action the provider already accepted, on a virtual or a wall clock.
// Terminal-only actions answer `result` only after a terminal state was observed; otherwise the
// observation stops at the request's deadline (or the shutdown drain) and the action is reported with
// Capsule's own PendingOperationError, carrying the locator, last state and observation count.

/** Time as one operation sees it. Virtual time moves only when the operation sleeps. */
export interface OperationTimer {
  /** Milliseconds since the operation started. */
  elapsed(): number;
  sleep(ms: number): Promise<void>;
}

export interface Clock {
  readonly kind: "virtual" | "wall";
  timer(): OperationTimer;
}

/**
 * The fixture profile's clock. Each sleep advances the operation's own time by exactly the requested
 * amount and yields once to the event loop, so deadlines and observation counts are deterministic and
 * independent of host speed. An operation that never sleeps never reaches a deadline by itself.
 */
export const virtualClock: Clock = {
  kind: "virtual",
  timer() {
    let now = 0;
    return {
      elapsed: () => now,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          now += ms;
          setImmediate(resolve);
        })
    };
  }
};

export const wallClock: Clock = {
  kind: "wall",
  timer() {
    const start = performance.now();
    return {
      elapsed: () => performance.now() - start,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))
    };
  }
};

export type PendingReason = "observation_deadline" | "shutting_down";
export type UnknownReason = "reply_lost" | "observation_failed";

/** PendingOperationError with the bridge reason it is answered with. */
export class BridgePendingError extends PendingOperationError {
  constructor(
    readonly reason: PendingReason,
    details: ConstructorParameters<typeof PendingOperationError>[1]
  ) {
    super(`${details.operation} is still pending: ${reason}.`, details);
  }
}

/** UnknownOutcomeError with the bridge reason it is answered with. */
export class BridgeUnknownError extends UnknownOutcomeError {
  constructor(
    readonly reason: UnknownReason,
    details: ConstructorParameters<typeof UnknownOutcomeError>[1],
    cause?: unknown
  ) {
    super(`${details.operation} outcome is unknown: ${reason}.`, details, cause);
  }
}

export type ObservationStep = { terminal: true } | { terminal: false; state?: string };

export interface BoundedObservation {
  timer: OperationTimer;
  intervalMs: number;
  /** The request's deadline_ms or the observe's wait_ms, in the timer's time. */
  budgetMs: number;
  /** When a shutdown drain ends for this operation, in the timer's time; undefined while not draining. */
  drainAt: () => number | undefined;
  /** One read of the resource. It changes nothing at the provider. */
  read: () => Promise<ObservationStep>;
  operation: string;
  resource: ResourceLocator;
  /** State to report when no observation has named one yet. */
  initialState?: string;
}

/**
 * Observes until terminal. Observations happen at elapsed 0, interval, 2 x interval, ... while elapsed
 * is below both the budget and the drain end. Throws BridgePendingError when neither terminal state
 * nor time is left, and BridgeUnknownError(observation_failed) when a read fails.
 */
export async function observeUntilTerminal(options: BoundedObservation): Promise<{ observations: number }> {
  let observations = 0;
  let lastState = options.initialState;
  const pending = (reason: PendingReason) =>
    new BridgePendingError(reason, {
      operation: options.operation,
      resource: options.resource,
      ...(lastState === undefined ? {} : { state: lastState }),
      deadlineMs: options.budgetMs,
      observations
    });
  while (true) {
    const now = options.timer.elapsed();
    const drainAt = options.drainAt();
    if (drainAt !== undefined && now >= drainAt) throw pending("shutting_down");
    if (now >= options.budgetMs) throw pending("observation_deadline");
    observations += 1;
    let step: ObservationStep;
    try {
      step = await options.read();
    } catch (error) {
      throw new BridgeUnknownError("observation_failed", { operation: options.operation, resource: options.resource }, error);
    }
    if (step.terminal) return { observations };
    if (step.state !== undefined) lastState = step.state;
    const left = Math.min(options.budgetMs, drainAt ?? Number.POSITIVE_INFINITY) - options.timer.elapsed();
    await options.timer.sleep(Math.min(options.intervalMs, Math.max(left, 0)) || options.intervalMs);
  }
}
