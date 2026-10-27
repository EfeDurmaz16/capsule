import { spawn } from "node:child_process";
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
   * The note runDocker appended to `stderr` after the captured output when it timed out. Callers that
   * post-process captured output (for example redacting a secret cut by the byte cap) apply that to the
   * part of `stderr` before this note.
   */
  timeoutNote?: string;
  /**
   * Set when an output stream reached its byte cap with overflow "error" but the command timed out
   * before it exited. The timeout wins, because the process may still be running; this keeps the limit.
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
}

class StreamCapture {
  private readonly decoder = new TextDecoder();
  private text = "";
  private readonly budget?: CaptureBudget;
  limitError?: CaptureLimitError;

  constructor(bounds?: ResolvedCaptureBounds) {
    this.budget = bounds ? new CaptureBudget(bounds) : undefined;
  }

  push(chunk: Buffer): void {
    if (!this.budget) {
      this.text += this.decoder.decode(chunk, { stream: true });
      return;
    }
    if (this.budget.exhausted) return;
    try {
      this.text += this.decoder.decode(this.budget.takeBytes(chunk), { stream: true });
    } catch (error) {
      if (!(error instanceof CaptureLimitError)) throw error;
      this.limitError = error;
    }
  }

  finish(): string {
    this.text += this.decoder.decode();
    return this.text;
  }

  truncation(): CaptureTruncation | undefined {
    return this.budget?.truncation();
  }
}

export function runDocker(args: string[], options: RunDockerOptions = {}): Promise<DockerCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal, killSignal: "SIGKILL" as const } : {})
    });
    const stdout = new StreamCapture(options.outputBounds?.stdout);
    const stderr = new StreamCapture(options.outputBounds?.stderr);
    let settled = false;

    const finish = (exitCode: number, extra: Partial<DockerCommandResult> = {}): void => {
      const stdoutText = stdout.finish();
      const stderrText = stderr.finish();
      const limitError = stdout.limitError ?? stderr.limitError;
      // A capture-limit error is raised only after the command exits. A timeout means the process may
      // still be running in the daemon, which the caller must learn first, so it resolves as timed out.
      if (limitError && !extra.timedOut) {
        reject(limitError);
        return;
      }
      const truncation = options.outputBounds ? { truncation: { stdout: stdout.truncation()!, stderr: stderr.truncation()! } } : {};
      resolve({
        exitCode,
        stdout: stdoutText,
        stderr: extra.stderr === undefined ? stderrText : stderrText ? `${stderrText}\n${extra.stderr}` : extra.stderr,
        ...(extra.timedOut ? { timedOut: true } : {}),
        ...(extra.timedOut && extra.stderr !== undefined ? { timeoutNote: extra.stderr } : {}),
        ...(limitError ? { captureLimit: limitError } : {}),
        ...truncation
      });
    };

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            child.kill("SIGKILL");
            finish(124, { timedOut: true, stderr: `Command timed out after ${options.timeoutMs}ms` });
          }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      if (timer) {
        clearTimeout(timer);
      }
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
