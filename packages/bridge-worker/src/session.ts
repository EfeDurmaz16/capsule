import { redactSensitiveText } from "@capsule-sdk/core";
import type { WorkerConfig } from "./config.js";
import { dispatchObserve, dispatchRequest, IdempotencyTable, refusalAnswer, type Answer, type DispatchContext, type OperationRuntime } from "./dispatch.js";
import type { BridgeDriver } from "./driver.js";
import { decodeBody, encodeFrame, FrameError, FrameReader } from "./frame.js";
import type { OperationTimer } from "./observe.js";
import { actionCapability } from "./profiles.js";
import { correlation, HelloRefusal, isKey, parseCancel, parseHello, parseObserve, parseRequest, parseShutdown, Refusal } from "./validate.js";
import {
  MAX_FRAME_BYTES,
  MAX_REQUEST_BYTES,
  PROTOCOL_VERSION,
  WORKER_ID,
  WORKER_MAX_IN_FLIGHT,
  WORKER_MAX_STDERR_BYTES,
  type BridgeAction,
  type HelloLimits,
  type ProtocolErrorCode,
  type Unresolved,
  type WireLocator,
  type WorkerMessage
} from "./wire.js";

// One worker connection: the handshake, then requests, observes, cancels and a shutdown, over one
// framed byte stream each way. The session holds no durable job state. Losing it is transport loss:
// it never cancels provider work on its own, and it never retries an effect.

/** Where the session writes and how it ends. The process entry wires these to stdio. */
export interface SessionIO {
  /** Writes one whole frame, in order. */
  write(frame: Buffer): void;
  /** Closes the output after everything written so far. */
  close(): void;
  /** Ends the worker with this status, after `close`. */
  exit(code: number): void;
  /** Stops reading input; called when a framing error makes the rest of the stream meaningless. */
  stopInput?(): void;
  /** Diagnostic text, already bounded and redacted by the session. */
  stderr?(text: string): void;
}

export interface SessionOptions {
  driver: BridgeDriver;
  config: WorkerConfig;
  io: SessionIO;
}

interface InFlight extends OperationRuntime {
  action: BridgeAction;
  kind: "request" | "observe";
  cancelController: AbortController;
  drainController: AbortController;
  drainEnd: number | undefined;
  progressSeq: number;
  resource?: WireLocator;
  done: Promise<void>;
}

const MAX_PROGRESS = 16;
const MAX_REMEMBERED_REQUEST_IDS = 65_536;

/** A Set that forgets its oldest entries past a capacity, so per-connection memory stays bounded. */
class BoundedSet {
  private readonly values = new Set<string>();
  constructor(private readonly capacity: number) {}
  has(value: string): boolean {
    return this.values.has(value);
  }
  add(value: string): void {
    this.values.add(value);
    if (this.values.size > this.capacity) this.values.delete(this.values.values().next().value as string);
  }
}

export class WorkerSession {
  private phase: "handshake" | "session" | "draining" | "closed" = "handshake";
  private limits: HelloLimits = {
    max_request_bytes: MAX_REQUEST_BYTES,
    max_frame_bytes: MAX_FRAME_BYTES,
    max_in_flight: WORKER_MAX_IN_FLIGHT,
    max_stderr_bytes: WORKER_MAX_STDERR_BYTES
  };
  private readonly reader = new FrameReader(() => (this.phase === "handshake" ? MAX_REQUEST_BYTES : this.limits.max_request_bytes));
  private readonly inFlight = new Map<string, InFlight>();
  private readonly seenRequestIds = new BoundedSet(MAX_REMEMBERED_REQUEST_IDS);
  private readonly answered = new BoundedSet(MAX_REMEMBERED_REQUEST_IDS);
  private readonly idempotency = new IdempotencyTable();
  private readonly context: DispatchContext;
  private stderrLeft = WORKER_MAX_STDERR_BYTES;
  private exitCode: number | undefined;
  private readonly exited: Promise<number>;
  private resolveExit: (code: number) => void = () => undefined;

  constructor(private readonly options: SessionOptions) {
    this.context = {
      driver: options.driver,
      config: options.config,
      idempotency: this.idempotency,
      diagnostic: (text) => this.diagnostic(text)
    };
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  /** Resolves with the exit status once the session has ended. */
  get exit(): Promise<number> {
    return this.exited;
  }

  private isClosed(): boolean {
    return this.phase === "closed";
  }

  /** Bytes from Fabric. */
  push(chunk: Uint8Array): void {
    if (this.phase === "closed") return;
    this.reader.push(chunk);
    while (!this.isClosed()) {
      let body: Buffer | undefined;
      try {
        body = this.reader.next();
      } catch (error) {
        if (error instanceof FrameError) return this.fail(error.code, error.message);
        throw error;
      }
      if (!body) return;
      let message: Record<string, unknown>;
      try {
        message = decodeBody(body);
      } catch (error) {
        if (error instanceof FrameError) return this.fail(error.code, error.message);
        throw error;
      }
      this.handle(message);
    }
  }

  /** End of Fabric's stream: a shutdown with drain 0 that no one acknowledges. */
  end(): void {
    if (this.phase === "closed") return;
    try {
      this.reader.end();
    } catch (error) {
      if (error instanceof FrameError) return this.fail(error.code, error.message);
      throw error;
    }
    if (this.phase === "handshake") return this.finish(0);
    void this.shutdown(undefined, 0);
  }

  /** A signal such as SIGTERM: a shutdown with `drainMs` whose acknowledgement no one reads. */
  terminate(drainMs: number): void {
    if (this.phase === "handshake") return this.finish(0);
    if (this.phase === "session") void this.shutdown(undefined, drainMs);
  }

  /**
   * Test seam for worker loss: stop at once, write nothing more, and leave provider work as it is.
   * A killed worker cancels nothing.
   */
  kill(): void {
    this.phase = "closed";
    this.options.io.stopInput?.();
  }

  private handle(message: Record<string, unknown>): void {
    const type = message.type;
    if (this.phase === "handshake") {
      if (type !== "hello") return this.fail("unexpected", "the first frame must be hello");
      return this.hello(message);
    }
    switch (type) {
      case "request":
        return this.request(message);
      case "observe":
        return this.observe(message);
      case "cancel":
        return this.cancel(message);
      case "shutdown":
        return this.shutdownMessage(message);
      default:
        return this.fail("unexpected", `unexpected ${typeof type === "string" ? type : "message"} frame in session`);
    }
  }

  private hello(message: Record<string, unknown>): void {
    const profile = this.options.driver.profile;
    try {
      const hello = parseHello(message, profile, { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION });
      this.limits = {
        max_request_bytes: Math.min(hello.limits.max_request_bytes, MAX_REQUEST_BYTES),
        max_frame_bytes: Math.min(hello.limits.max_frame_bytes, MAX_FRAME_BYTES),
        max_in_flight: Math.min(hello.limits.max_in_flight, WORKER_MAX_IN_FLIGHT),
        max_stderr_bytes: Math.min(hello.limits.max_stderr_bytes, WORKER_MAX_STDERR_BYTES)
      };
      this.stderrLeft = this.limits.max_stderr_bytes;
      this.write({ type: "hello_ack", protocol: PROTOCOL_VERSION, worker: WORKER_ID, profile, limits: this.limits }, MAX_REQUEST_BYTES);
      this.phase = "session";
    } catch (error) {
      if (!(error instanceof HelloRefusal)) throw error;
      // hello_refused never changes shape in any protocol version, so every Fabric can read it.
      this.write(
        { type: "hello_refused", versions: { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION }, reason: { code: error.code, message: error.message } },
        MAX_REQUEST_BYTES
      );
      this.finish(2);
    }
  }

  private request(message: Record<string, unknown>): void {
    const ids = correlation(message);
    if (!ids) return this.fail("malformed", "a request needs a valid request_id and operation.id to be answered");
    const refused = this.admission(ids.requestId);
    if (refused) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, refused));
    let request;
    try {
      request = parseRequest(message, this.options.driver.profile);
    } catch (error) {
      if (error instanceof Refusal) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, error));
      throw error;
    }
    const capacity = this.capacity();
    if (capacity) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, capacity));
    const runtime = this.track(ids.requestId, ids.operationId, request.action, "request", "target" in request ? request.target : undefined);
    this.run(runtime, dispatchRequest(this.context, runtime, request));
  }

  private observe(message: Record<string, unknown>): void {
    const ids = correlation(message);
    if (!ids) return this.fail("malformed", "an observe needs a valid request_id and operation_id to be answered");
    const refused = this.admission(ids.requestId);
    if (refused) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, refused));
    let observe;
    try {
      observe = parseObserve(message, this.options.driver.profile);
    } catch (error) {
      if (error instanceof Refusal) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, error));
      throw error;
    }
    const capacity = this.capacity();
    if (capacity) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, capacity));
    const runtime = this.track(ids.requestId, ids.operationId, observe.action, "observe", observe.resource);
    this.run(runtime, dispatchObserve(this.context, runtime, observe));
  }

  private cancel(message: Record<string, unknown>): void {
    const ids = correlation(message);
    if (!ids) return this.fail("malformed", "a cancel needs a valid request_id and operation_id to be answered");
    // A cancel is not new work: it is still handled while a shutdown drains.
    const refused = this.admission(ids.requestId, true);
    if (refused) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, refused));
    let cancel;
    try {
      cancel = parseCancel(message);
    } catch (error) {
      if (error instanceof Refusal) return this.answerNow(refusalAnswer(ids.requestId, ids.operationId, error));
      throw error;
    }
    const target = this.inFlight.get(cancel.cancels);
    let state: "requested" | "not_found" | "already_answered" | "unsupported";
    if (!target || target.operationId !== cancel.operation_id) {
      state = !target && this.answered.has(cancel.cancels) ? "already_answered" : "not_found";
    } else if (target.kind === "observe" || !actionCapability(this.options.driver.profile, target.action)?.cancel) {
      // The worker keeps waiting; the cancelled request still gets its own answer.
      state = "unsupported";
    } else {
      state = "requested";
    }
    this.write({ type: "cancel_ack", request_id: cancel.request_id, cancels: cancel.cancels, state });
    this.answered.add(cancel.request_id);
    // The acknowledgement goes out first. It says only that the cancel arrived, never that it ended anything.
    if (state === "requested") target!.cancelController.abort();
  }

  private shutdownMessage(message: Record<string, unknown>): void {
    if (this.phase === "draining") {
      this.diagnostic("a second shutdown was ignored");
      return;
    }
    if (!isKey(message.request_id) || this.seenRequestIds.has(message.request_id)) {
      return this.fail("malformed", "a shutdown needs a new valid request_id");
    }
    let shutdown;
    try {
      shutdown = parseShutdown(message);
    } catch (error) {
      if (error instanceof Refusal) return this.fail("malformed", `shutdown: ${error.message}`);
      throw error;
    }
    this.seenRequestIds.add(shutdown.request_id);
    void this.shutdown(shutdown.request_id, shutdown.drain_ms);
  }

  /** Refusals that hold for any request id: a repeat, or new work during a drain. */
  private admission(requestId: string, duringDrain = false): Refusal | undefined {
    if (this.seenRequestIds.has(requestId)) return new Refusal("invalid", "duplicate_request_id");
    this.seenRequestIds.add(requestId);
    if (this.phase === "draining" && !duringDrain) return new Refusal("unavailable", "shutting_down");
    return undefined;
  }

  private capacity(): Refusal | undefined {
    return this.inFlight.size >= this.limits.max_in_flight ? new Refusal("unavailable", "busy") : undefined;
  }

  private track(requestId: string, operationId: string, action: BridgeAction, kind: "request" | "observe", resource: WireLocator | undefined): InFlight {
    const timer: OperationTimer = this.options.driver.clock.timer();
    const cancelController = new AbortController();
    const drainController = new AbortController();
    const entry: InFlight = {
      requestId,
      operationId,
      action,
      kind,
      timer,
      cancelController,
      drainController,
      cancel: cancelController.signal,
      drained: drainController.signal,
      drainEnd: undefined,
      drainAt: () => entry.drainEnd,
      progressSeq: 0,
      ...(resource ? { resource } : {}),
      progress: (state, locator) => {
        if (this.phase === "closed" || entry.progressSeq >= MAX_PROGRESS || !this.inFlight.has(requestId)) return;
        entry.progressSeq += 1;
        entry.resource = locator;
        this.write({ type: "progress", request_id: requestId, operation_id: operationId, seq: entry.progressSeq, state, resource: locator });
      },
      done: Promise.resolve()
    };
    this.inFlight.set(requestId, entry);
    return entry;
  }

  private unresolved: Unresolved[] = [];

  private run(entry: InFlight, work: Promise<Answer>): void {
    entry.done = work.then(
      (answer) => this.settle(entry, answer),
      (error) => {
        // A bug, not an outcome: the worker cannot tell what the provider did.
        this.diagnostic(`internal error: ${error instanceof Error ? error.message : String(error)}`);
        this.settle(entry, {
          type: "error",
          request_id: entry.requestId,
          operation_id: entry.operationId,
          error: {
            code: "unknown",
            reason: "reply_lost",
            message: "unknown: reply_lost",
            effect: "unknown",
            ...(entry.resource ? { resource: entry.resource } : {})
          }
        });
      }
    );
  }

  private settle(entry: InFlight, answer: Answer): void {
    this.inFlight.delete(entry.requestId);
    this.answered.add(entry.requestId);
    if (entry.drainEnd !== undefined && answer.type === "error" && (answer.error.code === "pending" || answer.error.code === "unknown")) {
      this.unresolved.push({
        request_id: entry.requestId,
        operation_id: entry.operationId,
        state: answer.error.code,
        ...(answer.error.resource ? { resource: answer.error.resource } : {})
      });
    }
    if (this.phase !== "closed") this.write(answer);
  }

  private answerNow(answer: Answer): void {
    this.answered.add(answer.request_id);
    this.write(answer);
  }

  private async shutdown(requestId: string | undefined, drainMs: number): Promise<void> {
    this.phase = "draining";
    const entries = [...this.inFlight.values()];
    for (const entry of entries) {
      entry.drainEnd = entry.timer.elapsed() + drainMs;
      // Awaits that are not observations (a running exec, a provider call) stop at the drain's end.
      const drainTimer = this.options.driver.clock.timer();
      void drainTimer.sleep(drainMs).then(() => entry.drainController.abort());
    }
    await Promise.all(entries.map((entry) => entry.done));
    if (this.isClosed()) return;
    if (requestId !== undefined) {
      this.write({ type: "shutdown_ack", request_id: requestId, unresolved: this.unresolved });
    }
    this.finish(0);
  }

  private fail(code: ProtocolErrorCode, message: string): void {
    if (this.phase === "closed") return;
    this.options.io.stopInput?.();
    this.write({ type: "protocol_error", code, message: message.slice(0, 1024) }, MAX_REQUEST_BYTES);
    this.finish(2);
  }

  private finish(code: number): void {
    if (this.exitCode !== undefined) return;
    this.exitCode = code;
    this.phase = "closed";
    this.options.io.close();
    this.options.io.exit(code);
    this.resolveExit(code);
  }

  private write(message: WorkerMessage, cap = this.phase === "handshake" ? MAX_REQUEST_BYTES : this.limits.max_frame_bytes): void {
    if (this.exitCode !== undefined) return;
    let frame: Buffer;
    try {
      frame = encodeFrame(message, cap);
    } catch (error) {
      if (!(error instanceof FrameError)) throw error;
      // An answer that would not fit the negotiated frame cannot be sent truthfully in part.
      this.diagnostic(error.message);
      this.options.io.write(encodeFrame({ type: "protocol_error", code: "oversize", message: error.message }, MAX_REQUEST_BYTES));
      this.finish(2);
      return;
    }
    this.options.io.write(frame);
  }

  private diagnostic(text: string): void {
    if (this.stderrLeft <= 0 || !this.options.io.stderr) return;
    const line = `${redactSensitiveText(text, undefined)}\n`;
    const bytes = Buffer.from(line, "utf8").subarray(0, this.stderrLeft);
    this.stderrLeft -= bytes.byteLength;
    this.options.io.stderr(bytes.toString("utf8"));
  }
}
