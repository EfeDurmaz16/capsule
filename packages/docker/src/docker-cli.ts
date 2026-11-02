import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { CaptureBudget, CaptureLimitError, type CaptureTruncation, type ResolvedCaptureBounds } from "@capsule-sdk/core";

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * True when runDocker gave up after timeoutMs and killed the local docker CLI process. Killing the
   * client does not stop the container or exec'd process in the daemon; callers must reconcile.
   */
  timedOut?: boolean;
  /**
   * True when runDocker killed the local docker CLI process at deadlineMs. As with a timeout, only the
   * client stopped: the exec'd process may still be running in the daemon, so the outcome is unknown.
   */
  deadlineExceeded?: boolean;
  /**
   * The note runDocker appended to `stderr` after the captured output when it timed out or reached its
   * deadline. Callers that post-process captured output (for example redacting a secret cut by the byte
   * cap) apply that to the part of `stderr` before this note.
   */
  timeoutNote?: string;
  /**
   * Set when an output stream reached its byte cap with overflow "error" but the command timed out or
   * reached its deadline before it exited. The stop wins, because the process may still be running; this
   * keeps the limit.
   */
  captureLimit?: CaptureLimitError;
  /** Present when outputBounds were applied: per stream, whether and why output was truncated. */
  truncation?: { stdout: CaptureTruncation; stderr: CaptureTruncation };
}

export interface DockerOutputBounds {
  stdout: ResolvedCaptureBounds;
  stderr: ResolvedCaptureBounds;
}

export interface RunDockerOptions {
  timeoutMs?: number;
  /**
   * Client-side deadline for the whole command (ExecSpec.bounds.deadlineMs). When it expires the local
   * docker CLI is killed exactly like a timeout, the output captured so far is kept and the result
   * carries `deadlineExceeded`. Independent of timeoutMs: whichever expires first stops the CLI.
   */
  deadlineMs?: number;
  input?: string;
  /**
   * Per-stream capture bounds, enforced while the output arrives. Bytes past the cap are read and
   * discarded so the process never blocks on a full pipe, and the result carries `truncation`.
   */
  outputBounds?: DockerOutputBounds;
  /**
   * Aborting kills the local docker CLI with SIGKILL and rejects with the signal's AbortError. Like a
   * timeout, this stops only the client: a container or an exec'd process keeps running in the daemon.
   */
  signal?: AbortSignal;
  /** Starts the CLI in a process group of its own, which a signal to the caller's group misses. */
  detached?: boolean;
}

class StreamCapture {
  // StringDecoder, as stream.setEncoding("utf8") used before bounds existed: it keeps a leading BOM and
  // decodes about eight times faster than a streaming TextDecoder (PERF-10 A/B against 7d3a28a).
  private readonly decoder = new StringDecoder("utf8");
  private text = "";
  private readonly budget?: CaptureBudget;
  limitError?: CaptureLimitError;

  constructor(bounds?: ResolvedCaptureBounds) {
    this.budget = bounds ? new CaptureBudget(bounds) : undefined;
  }

  push(chunk: Buffer): void {
    if (!this.budget) {
      this.text += this.decoder.write(chunk);
      return;
    }
    if (this.budget.exhausted) return;
    try {
      this.text += this.decoder.write(this.budget.takeBytes(chunk));
    } catch (error) {
      if (!(error instanceof CaptureLimitError)) throw error;
      this.limitError = error;
    }
  }

  finish(): string {
    this.text += this.decoder.end();
    return this.text;
  }

  truncation(): CaptureTruncation | undefined {
    return this.budget?.truncation();
  }
}

// Node fires a setTimeout longer than 2^31 - 1 ms after 1 ms; a longer deadline uses the largest delay.
const maxTimerDelayMs = 2_147_483_647;

export function runDocker(args: string[], options: RunDockerOptions = {}): Promise<DockerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal, killSignal: "SIGKILL" as const } : {}),
      ...(options.detached ? { detached: true } : {})
    });
    const stdout = new StreamCapture(options.outputBounds?.stdout);
    const stderr = new StreamCapture(options.outputBounds?.stderr);
    let settled = false;

    const finish = (exitCode: number, extra: Partial<DockerCommandResult> = {}): void => {
      const stdoutText = stdout.finish();
      const stderrText = stderr.finish();
      const limitError = stdout.limitError ?? stderr.limitError;
      const stopped = extra.timedOut === true || extra.deadlineExceeded === true;
      // A capture-limit error is raised only after the command exits. A timeout or deadline means the
      // process may still be running in the daemon, which the caller must learn first, so it resolves
      // as stopped.
      if (limitError && !stopped) {
        reject(limitError);
        return;
      }
      const truncation = options.outputBounds ? { truncation: { stdout: stdout.truncation()!, stderr: stderr.truncation()! } } : {};
      resolve({
        exitCode,
        stdout: stdoutText,
        stderr: extra.stderr === undefined ? stderrText : stderrText ? `${stderrText}\n${extra.stderr}` : extra.stderr,
        ...(extra.timedOut ? { timedOut: true } : {}),
        ...(extra.deadlineExceeded ? { deadlineExceeded: true } : {}),
        ...(stopped && extra.stderr !== undefined ? { timeoutNote: extra.stderr } : {}),
        ...(limitError ? { captureLimit: limitError } : {}),
        ...truncation
      });
    };

    // timeoutMs and deadlineMs each arm a timer; the first to fire kills the CLI and settles the result.
    const timers: NodeJS.Timeout[] = [];
    const clearTimers = (): void => {
      for (const timer of timers) clearTimeout(timer);
    };
    const stopAfter = (ms: number | undefined, outcome: () => Partial<DockerCommandResult>): void => {
      if (ms === undefined) return;
      timers.push(
        setTimeout(
          () => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimers();
            child.kill("SIGKILL");
            finish(124, outcome());
          },
          Math.min(ms, maxTimerDelayMs)
        )
      );
    };
    stopAfter(options.timeoutMs, () => ({ timedOut: true, stderr: `Command timed out after ${options.timeoutMs}ms` }));
    stopAfter(options.deadlineMs, () => ({ deadlineExceeded: true, stderr: `Capture deadline of ${options.deadlineMs}ms expired` }));

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimers();
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      clearTimers();
      if (!settled) {
        settled = true;
        finish(exitCode ?? 1);
      }
    });

    // Write the input (possibly empty) and always end stdin so the command sees EOF.
    child.stdin.on("error", () => undefined);
    if (options.input !== undefined && options.input.length > 0) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const result = await runDocker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
