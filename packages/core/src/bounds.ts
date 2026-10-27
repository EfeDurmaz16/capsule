import { CapsuleError } from "./errors.js";
import type { CapsulePolicy } from "./types.js";

// Capture bounds (CD-BOUNDS) ----------------------------------------------------------------------
// Explicit per-operation budgets for output, logs and HTTP bodies, enforced while consuming rather
// than by slicing after everything was buffered. When a cap is hit the result says so through a
// visible truncation record. These bounds are client-side: a provider-side wait or timeout parameter
// is a separate setting and never substitutes for the client deadline.

/** What to do when a byte or record cap is reached. */
export type CaptureOverflow = "truncate" | "error";

/** Why a capture stopped before the source was exhausted. */
export type TruncationReason = "bytes" | "records" | "deadline" | "aborted";

export interface CaptureBounds {
  /** Maximum captured bytes. For exec output this applies to each stream separately. */
  maxBytes?: number;
  /** Maximum captured records (log entries, lines or items). */
  maxRecords?: number;
  /** Client-side deadline in milliseconds for the whole capture, including every provider request. */
  deadlineMs?: number;
  /** Maximum provider requests in flight at once for multi-source captures. */
  concurrency?: number;
  /** Defaults to "truncate". "error" throws CaptureLimitError instead of returning a truncated result. */
  overflow?: CaptureOverflow;
}

export interface ResolvedCaptureBounds {
  maxBytes: number;
  maxRecords: number;
  deadlineMs: number;
  concurrency: number;
  overflow: CaptureOverflow;
}

/** Visible record of what a capture actually kept. */
export interface CaptureTruncation {
  truncated: boolean;
  reason?: TruncationReason;
  capturedBytes: number;
  capturedRecords?: number;
  /** The cap that was reached, in bytes, records or milliseconds depending on reason. */
  limit?: number;
}

/**
 * Documented conservative defaults. Adapters apply them only where they adopt CaptureBounds; the
 * values are deliberately generous so the default never silently cuts ordinary output.
 */
export const defaultCaptureBounds: Readonly<ResolvedCaptureBounds> = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxRecords: 10_000,
  deadlineMs: 60_000,
  concurrency: 4,
  overflow: "truncate"
});

export class CaptureLimitError extends CapsuleError {
  constructor(
    message: string,
    public readonly truncation: CaptureTruncation
  ) {
    super(message, "CAPSULE_CAPTURE_LIMIT_EXCEEDED");
    this.name = "CaptureLimitError";
  }
}

/**
 * Resolves caller bounds against defaults. Invalid values throw RangeError before any provider effect.
 * `ceiling` values (for example policy limits) can only lower a bound, never raise it.
 */
export function resolveCaptureBounds(bounds: CaptureBounds = {}, ceiling: Partial<Omit<ResolvedCaptureBounds, "overflow">> = {}): ResolvedCaptureBounds {
  const pick = (key: "maxBytes" | "maxRecords" | "deadlineMs" | "concurrency"): number => {
    const requested = bounds[key] === undefined ? defaultCaptureBounds[key] : positiveInteger(bounds[key], key);
    const limit = ceiling[key] === undefined ? undefined : positiveInteger(ceiling[key], key);
    return limit === undefined ? requested : Math.min(requested, limit);
  };
  const overflow = bounds.overflow ?? defaultCaptureBounds.overflow;
  if (overflow !== "truncate" && overflow !== "error") {
    throw new RangeError(`overflow must be "truncate" or "error".`);
  }
  return { maxBytes: pick("maxBytes"), maxRecords: pick("maxRecords"), deadlineMs: pick("deadlineMs"), concurrency: pick("concurrency"), overflow };
}

export interface ExecOutputBounds {
  stdout: ResolvedCaptureBounds;
  stderr: ResolvedCaptureBounds;
}

/** Resolves per-stream exec output bounds, honoring policy.limits.maxStdoutBytes and maxStderrBytes as ceilings. */
export function resolveExecOutputBounds(bounds: CaptureBounds | undefined, policy: CapsulePolicy = {}): ExecOutputBounds {
  const limits = policy.limits ?? {};
  return {
    stdout: resolveCaptureBounds(bounds, limits.maxStdoutBytes === undefined ? {} : { maxBytes: limits.maxStdoutBytes }),
    stderr: resolveCaptureBounds(bounds, limits.maxStderrBytes === undefined ? {} : { maxBytes: limits.maxStderrBytes })
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Incremental budget for one capture. Feed chunks or records as they arrive; the budget returns the
 * part that fits and records the first reason the capture stopped. Once exhausted it accepts nothing.
 */
export class CaptureBudget {
  private bytes = 0;
  private records = 0;
  private stopped?: { reason: TruncationReason; limit?: number };
  private readonly deadlineAt: number;

  constructor(
    readonly bounds: ResolvedCaptureBounds,
    private readonly now: () => number = Date.now
  ) {
    this.deadlineAt = now() + bounds.deadlineMs;
  }

  get exhausted(): boolean {
    return this.stopped !== undefined;
  }

  get remainingMs(): number {
    return Math.max(0, this.deadlineAt - this.now());
  }

  /** Accepts the UTF-8 prefix of `chunk` that fits, never splitting a code point. */
  takeText(chunk: string): string {
    const encoded = encoder.encode(chunk);
    const accepted = this.takeBytes(encoded);
    return accepted.byteLength === encoded.byteLength ? chunk : decoder.decode(accepted);
  }

  /** Accepts the prefix of `chunk` that fits. Text callers should use takeText to keep code points whole. */
  takeBytes(chunk: Uint8Array): Uint8Array {
    if (!this.admit()) return chunk.subarray(0, 0);
    const room = this.bounds.maxBytes - this.bytes;
    if (chunk.byteLength <= room) {
      this.bytes += chunk.byteLength;
      return chunk;
    }
    let end = room;
    while (end > 0 && end < chunk.byteLength && (chunk[end]! & 0xc0) === 0x80) end -= 1;
    this.bytes += end;
    this.stop("bytes", this.bounds.maxBytes);
    return chunk.subarray(0, end);
  }

  /** Admits one whole record of `byteLength` bytes, or rejects it whole when it does not fit. */
  takeRecord(byteLength = 0): boolean {
    if (!this.admit()) return false;
    if (this.records >= this.bounds.maxRecords) {
      this.stop("records", this.bounds.maxRecords);
      return false;
    }
    if (this.bytes + byteLength > this.bounds.maxBytes) {
      this.stop("bytes", this.bounds.maxBytes);
      return false;
    }
    this.records += 1;
    this.bytes += byteLength;
    return true;
  }

  /** Marks the capture as stopped by caller or provider abort. */
  abort(): void {
    if (!this.stopped) this.stopped = { reason: "aborted" };
  }

  truncation(): CaptureTruncation {
    return {
      truncated: this.stopped !== undefined,
      ...(this.stopped ? { reason: this.stopped.reason } : {}),
      capturedBytes: this.bytes,
      ...(this.records > 0 ? { capturedRecords: this.records } : {}),
      ...(this.stopped?.limit === undefined ? {} : { limit: this.stopped.limit })
    };
  }

  private admit(): boolean {
    if (this.stopped) return false;
    if (this.now() >= this.deadlineAt) {
      this.stop("deadline", this.bounds.deadlineMs);
      return false;
    }
    return true;
  }

  private stop(reason: TruncationReason, limit?: number): void {
    if (this.stopped) return;
    this.stopped = { reason, ...(limit === undefined ? {} : { limit }) };
    if (this.bounds.overflow === "error" && reason !== "aborted") {
      throw new CaptureLimitError(`Capture limit reached: ${reason}${limit === undefined ? "" : ` (${limit})`}.`, this.truncation());
    }
  }
}

/**
 * Reads at most `maxBytes` of a fetch Response body and cancels the rest, so an endless or oversized
 * body cannot grow memory without bound. Never calls response.text() or response.json().
 */
export async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string; truncation: CaptureTruncation }> {
  const budget = new CaptureBudget({
    ...defaultCaptureBounds,
    maxBytes: positiveInteger(maxBytes, "maxBytes"),
    deadlineMs: Number.MAX_SAFE_INTEGER,
    overflow: "truncate"
  });
  const body = response.body;
  if (!body) return { text: "", truncation: budget.truncation() };
  const reader = body.getReader();
  const streamDecoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const accepted = budget.takeBytes(value);
      text += streamDecoder.decode(accepted, { stream: true });
      if (budget.exhausted) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  text += streamDecoder.decode();
  return { text, truncation: budget.truncation() };
}

/**
 * Maps `items` with at most `limit` calls in flight and returns results in input order. After the
 * first rejection no new calls start and the returned promise rejects with that error.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const concurrency = positiveInteger(limit, "concurrency");
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}
