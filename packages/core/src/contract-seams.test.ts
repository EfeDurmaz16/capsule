// Shared M1 contract seams: machine transition statuses, CD-DELETE lifecycle errors and bounded
// observation and CD-BOUNDS capture budgets.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapsuleAdapter } from "./adapters.js";
import {
  CaptureBudget,
  CaptureLimitError,
  defaultCaptureBounds,
  mapWithConcurrency,
  readBoundedText,
  resolveCaptureBounds,
  resolveExecOutputBounds
} from "./bounds.js";
import { Capsule } from "./capsule.js";
import {
  AdapterExecutionError,
  CleanupFailureError,
  PartialEffectsError,
  PendingOperationError,
  UnknownOutcomeError,
  partialEffectsOf,
  type PartialEffects
} from "./errors.js";
import { isTransitionalMachineStatus, machineStatuses, observeUntilTerminal, resourceLocator, type MachineStatus } from "./lifecycle.js";
import type { Machine, MachineStatusResult } from "./types.js";

const locator = resourceLocator({ provider: "fake", kind: "service", nativeId: "svc-1", scope: { project: "p1" } });

describe("machine transition statuses", () => {
  it("includes every lifecycle transition the lifecycle result already returns", () => {
    expect([...machineStatuses].sort()).toEqual(["creating", "deleted", "destroying", "failed", "running", "starting", "stopped", "stopping"]);
    expect(machineStatuses.filter(isTransitionalMachineStatus)).toEqual(["creating", "starting", "stopping", "destroying"]);
    expect(isTransitionalMachineStatus("stopped")).toBe(false);
    const status: Machine["status"] = "stopping" satisfies MachineStatus;
    expect(status).toBe("stopping");
  });

  it("machine.status passes a transitional status through the facade unchanged", async () => {
    for (const native of ["starting", "stopping", "destroying"] as const) {
      const adapter: CapsuleAdapter = {
        name: "fake",
        provider: "fake",
        capabilities: { machine: { create: "native", status: "native", exec: "unsupported", start: "native", stop: "native", destroy: "native" } },
        machine: {
          create: async () => ({ id: "m1", provider: "fake", name: "m", status: "creating" }),
          status: async (spec): Promise<MachineStatusResult> => ({ id: spec.id, provider: "fake", status: native, metadata: { nativeState: native } })
        }
      };
      const result = await new Capsule({ adapter }).machine.status({ id: "m1" });
      expect(result.status).toBe(native);
    }
  });
});

describe("resource locators", () => {
  it("strips URL credentials, query strings and control characters and is frozen", () => {
    const value = resourceLocator({
      provider: "azure",
      kind: "blob",
      nativeId: "https://user:secret@acct.blob.example/c/blob?sv=2024&sig=SECRETSIG#frag",
      scope: { region: "eu\nwest", empty: "", missing: undefined },
      nativeOperationId: "op-1?token=abc"
    });
    expect(value).toEqual({
      provider: "azure",
      kind: "blob",
      nativeId: "https://acct.blob.example/c/blob",
      scope: { region: "euwest" },
      nativeOperationId: "op-1"
    });
    expect(JSON.stringify(value)).not.toMatch(/secret|SECRETSIG|token/);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.scope)).toBe(true);
  });

  it("keeps ordinary ARM and ARN identifiers intact and caps length", () => {
    const arm = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.App/containerApps/web";
    expect(resourceLocator({ provider: "azure", kind: "service", nativeId: arm }).nativeId).toBe(arm);
    const arn = "arn:aws:ecs:us-east-1:123456789012:service/c/web";
    expect(resourceLocator({ provider: "ecs", kind: "service", nativeId: arn }).nativeId).toBe(arn);
    expect(resourceLocator({ provider: "x", kind: "y", nativeId: "a".repeat(2000) }).nativeId).toHaveLength(512);
  });
});

describe("lifecycle outcome errors", () => {
  it("PendingOperationError carries operation, locator and last state", () => {
    const error = new PendingOperationError("pending", { operation: "service.delete", resource: locator, state: "Deleting", deadlineMs: 10, observations: 2 });
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect(error).toMatchObject({ code: "CAPSULE_OPERATION_PENDING", outcome: "pending", operation: "service.delete", resource: locator, state: "Deleting" });
  });

  it("UnknownOutcomeError is never retry-safe and keeps its cause", () => {
    const cause = new Error("socket hang up");
    const error = new UnknownOutcomeError("unknown", { operation: "service.deploy" }, cause);
    expect(error).toMatchObject({ code: "CAPSULE_OPERATION_OUTCOME_UNKNOWN", outcome: "unknown", retrySafe: false, cause });
    expect(error.resource).toBeUndefined();
  });

  it("partial effects keep primary and cleanup outcomes separate on both error classes", () => {
    const primaryError = new Error("route failed");
    const effects: PartialEffects = {
      operation: "edge.deploy",
      outcome: "failed",
      resources: [locator],
      primaryError,
      cleanup: { status: "not-attempted", residual: [locator] }
    };
    const partial = new PartialEffectsError("partial", effects);
    expect(partial).toMatchObject({ code: "CAPSULE_PARTIAL_EFFECTS", cause: primaryError });
    expect(partialEffectsOf(partial)).toBe(effects);

    const cleanupError = new Error("delete 503");
    const withCleanup = new CleanupFailureError(
      "cleanup failed",
      { attempted: true },
      { operationError: primaryError },
      {
        ...effects,
        cleanup: { status: "failed", error: cleanupError, residual: [locator] }
      }
    );
    expect(withCleanup.cause).toEqual({ operationError: primaryError });
    expect(partialEffectsOf(withCleanup)?.cleanup.error).toBe(cleanupError);
    expect(partialEffectsOf(withCleanup)?.primaryError).toBe(primaryError);

    const completed = new PartialEffectsError("destroy failed after exec", {
      operation: "sandbox.exec",
      outcome: "completed",
      resources: [locator],
      result: { exitCode: 0 },
      cleanup: { status: "failed", error: cleanupError }
    });
    expect(completed.cause).toBe(cleanupError);
    expect(completed.effects.result).toEqual({ exitCode: 0 });
  });

  it("legacy CleanupFailureError construction is unchanged", () => {
    const error = new CleanupFailureError("x", { a: 1 }, { operationError: "e" });
    expect(error.effects).toBeUndefined();
    expect(partialEffectsOf(error)).toBeUndefined();
    expect(error.code).toBe("CAPSULE_CLEANUP_FAILURE");
  });
});

describe("observeUntilTerminal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the terminal value once observed", async () => {
    let calls = 0;
    const value = await observeUntilTerminal(async () => (++calls < 3 ? { done: false, state: "Deleting" } : { done: true, value: "deleted" as const }), {
      operation: "service.delete",
      resource: locator,
      deadlineMs: 1_000,
      intervalMs: 0
    });
    expect(value).toBe("deleted");
    expect(calls).toBe(3);
  });

  it("throws PendingOperationError with the last state when the deadline expires, never a terminal value", async () => {
    vi.useFakeTimers();
    const outcome = observeUntilTerminal(async () => ({ done: false, state: "Deleting" }), {
      operation: "service.delete",
      resource: locator,
      deadlineMs: 5_000,
      intervalMs: 1_000
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(6_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(error).toMatchObject({ state: "Deleting", resource: locator, deadlineMs: 5_000 });
    expect((error as PendingOperationError).observations).toBeGreaterThanOrEqual(5);
  });

  it("bounds an observation that never settles and aborts its signal", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const outcome = observeUntilTerminal(
      ({ signal }) => {
        observedSignal = signal;
        return new Promise<never>(() => undefined);
      },
      { operation: "machine.destroy", resource: locator, deadlineMs: 2_000 }
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await outcome).toBeInstanceOf(PendingOperationError);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("rethrows a definitive failed step as is", async () => {
    const failure = new Error("operation failed");
    await expect(
      observeUntilTerminal(async () => ({ done: "failed", error: failure }), { operation: "service.delete", resource: locator, deadlineMs: 1_000 })
    ).rejects.toBe(failure);
  });

  it("reports an observation transport error as still pending with the error as cause", async () => {
    const transport = new Error("ECONNRESET");
    const error = await observeUntilTerminal(
      async () => {
        throw transport;
      },
      { operation: "service.delete", resource: locator, deadlineMs: 1_000 }
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect((error as PendingOperationError).cause).toBe(transport);
  });

  it("stops on caller abort and honors maxObservations", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller"));
    await expect(
      observeUntilTerminal(async () => ({ done: true, value: 1 }), { operation: "x", resource: locator, deadlineMs: 1_000, signal: controller.signal })
    ).rejects.toBeInstanceOf(PendingOperationError);
    let calls = 0;
    await expect(
      observeUntilTerminal(
        async () => {
          calls += 1;
          return { done: false };
        },
        { operation: "x", resource: locator, deadlineMs: 10_000, intervalMs: 0, maxObservations: 2 }
      )
    ).rejects.toBeInstanceOf(PendingOperationError);
    expect(calls).toBe(2);
  });

  it("rejects an unbounded deadline before observing", async () => {
    const observe = vi.fn();
    await expect(observeUntilTerminal(observe, { operation: "x", resource: locator, deadlineMs: Number.POSITIVE_INFINITY })).rejects.toBeInstanceOf(RangeError);
    expect(observe).not.toHaveBeenCalled();
  });
});

describe("capture bounds", () => {
  it("resolves documented defaults, applies ceilings and rejects invalid values", () => {
    expect(resolveCaptureBounds()).toEqual(defaultCaptureBounds);
    expect(resolveCaptureBounds({ maxBytes: 100 }, { maxBytes: 10 }).maxBytes).toBe(10);
    expect(resolveCaptureBounds({ maxBytes: 5 }, { maxBytes: 10 }).maxBytes).toBe(5);
    expect(() => resolveCaptureBounds({ maxBytes: 0 })).toThrow(RangeError);
    expect(() => resolveCaptureBounds({ concurrency: 1.5 })).toThrow(RangeError);
    const exec = resolveExecOutputBounds({ maxBytes: 1_000 }, { limits: { maxStdoutBytes: 10, maxStderrBytes: 20 } });
    expect([exec.stdout.maxBytes, exec.stderr.maxBytes]).toEqual([10, 20]);
  });

  it("truncates text on a code point boundary and records the reason", () => {
    const budget = new CaptureBudget(resolveCaptureBounds({ maxBytes: 4 }));
    expect(budget.takeText("ab")).toBe("ab");
    expect(budget.takeText("éé")).toBe("é");
    expect(budget.takeText("more")).toBe("");
    expect(budget.truncation()).toEqual({ truncated: true, reason: "bytes", capturedBytes: 4, limit: 4 });
  });

  it("caps records whole and stops at the deadline", () => {
    let now = 0;
    const budget = new CaptureBudget(resolveCaptureBounds({ maxRecords: 2, deadlineMs: 100 }), () => now);
    expect([budget.takeRecord(1), budget.takeRecord(1), budget.takeRecord(1)]).toEqual([true, true, false]);
    expect(budget.truncation()).toMatchObject({ truncated: true, reason: "records", capturedRecords: 2, limit: 2 });
    const timed = new CaptureBudget(resolveCaptureBounds({ deadlineMs: 100 }), () => now);
    now = 100;
    expect(timed.takeText("x")).toBe("");
    expect(timed.truncation()).toMatchObject({ truncated: true, reason: "deadline" });
  });

  it("throws CaptureLimitError in error overflow mode", () => {
    const budget = new CaptureBudget(resolveCaptureBounds({ maxBytes: 2, overflow: "error" }));
    expect(() => budget.takeText("abc")).toThrow(CaptureLimitError);
  });

  it("reads at most maxBytes from an endless body and cancels it", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("0123456789"));
      },
      cancel() {
        cancelled = true;
      }
    });
    const { text, truncation } = await readBoundedText(new Response(body), 25);
    expect(text).toBe("0123456789012345678901234");
    expect(truncation).toMatchObject({ truncated: true, reason: "bytes", capturedBytes: 25 });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it("maps with bounded concurrency, keeps input order and stops scheduling after a failure", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, value));
      inFlight -= 1;
      return value * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 1, async (value) => {
        started.push(value);
        if (value === 2) throw new Error("boom");
        return value;
      })
    ).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });
});
