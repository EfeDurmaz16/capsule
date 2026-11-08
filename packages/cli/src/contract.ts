// The CLI contract in one place: failure reasons and their exit codes, output modes, color, and the
// single renderer for errors. docs/cli.md describes the same contract for users and scripts.
import { createInterface } from "node:readline";

// Usage reasons exit 2; every other failure exits 1. A declined confirmation exits 130.
const usageReasons = ["unknown_command", "unknown_option", "invalid_arguments", "missing_value", "unknown_adapter", "action_required"] as const;
const operationalReasons = [
  "unsupported_capability",
  "policy_denied",
  "provider_auth",
  "provider_rejected",
  "rate_limited",
  "provider_unavailable",
  "pending",
  "unknown_outcome",
  "partial_failure",
  "cleanup_failed",
  "provider_error",
  "failed",
  "internal_error"
] as const;

export type Reason = (typeof usageReasons)[number] | (typeof operationalReasons)[number] | "canceled";

export const exitCodes = { ok: 0, failure: 1, usage: 2, canceled: 130 } as const;

export interface CliErrorOptions {
  hint?: string;
  next?: string[];
  retryable?: boolean;
  data?: Record<string, unknown>;
  cause?: unknown;
}

export class CliError extends Error {
  readonly hint?: string;
  readonly next?: string[];
  readonly retryable: boolean;
  readonly data?: Record<string, unknown>;

  constructor(
    readonly reason: Reason,
    message: string,
    options: CliErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliError";
    this.hint = options.hint;
    this.next = options.next;
    this.retryable = options.retryable ?? false;
    this.data = options.data;
  }

  get exitCode(): number {
    if (this.reason === "canceled") return exitCodes.canceled;
    return (usageReasons as readonly string[]).includes(this.reason) ? exitCodes.usage : exitCodes.failure;
  }
}

export function usageError(message: string, reason: Reason = "invalid_arguments", options: CliErrorOptions = {}): CliError {
  return new CliError(reason, message, options);
}

// SDK error codes from @capsule-sdk/core, mapped by code so the CLI does not depend on class identity.
const sdkReasons: Record<string, { reason: Reason; retryable?: boolean; next?: string[] }> = {
  CAPSULE_UNSUPPORTED_CAPABILITY: { reason: "unsupported_capability" },
  CAPSULE_POLICY_VIOLATION: { reason: "policy_denied" },
  CAPSULE_PROVIDER_AUTH_ERROR: { reason: "provider_auth", next: ["capsule", "doctor"] },
  CAPSULE_PROVIDER_VALIDATION_ERROR: { reason: "provider_rejected" },
  CAPSULE_PROVIDER_RATE_LIMIT_ERROR: { reason: "rate_limited", retryable: true },
  CAPSULE_PROVIDER_RETRYABLE_ERROR: { reason: "provider_unavailable", retryable: true },
  CAPSULE_OPERATION_PENDING: { reason: "pending" },
  CAPSULE_OPERATION_OUTCOME_UNKNOWN: { reason: "unknown_outcome" },
  CAPSULE_PARTIAL_EFFECTS: { reason: "partial_failure" },
  CAPSULE_CLEANUP_FAILURE: { reason: "cleanup_failed" },
  CAPSULE_ADAPTER_EXECUTION_ERROR: { reason: "provider_error" }
};

const programmerErrors = [TypeError, ReferenceError, RangeError, SyntaxError];

/** The only place a thrown value becomes a CLI error. */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (!(error instanceof Error)) return new CliError("failed", String(error));
  const code = (error as { code?: unknown }).code;
  const mapped = typeof code === "string" ? sdkReasons[code] : undefined;
  if (mapped) {
    const operation = (error as { operation?: unknown }).operation;
    const data = { code, ...(typeof operation === "string" ? { operation } : {}) };
    return new CliError(mapped.reason, error.message, { retryable: mapped.retryable, next: mapped.next, cause: error, data });
  }
  const internal = programmerErrors.some((type) => error instanceof type);
  return new CliError(internal ? "internal_error" : "failed", error.message, { cause: error });
}

export interface Modes {
  json: boolean;
  interactive: boolean;
  color: boolean;
  debug: boolean;
}

export interface ModeFlags {
  json?: boolean;
  nonInteractive?: boolean;
  noColor?: boolean;
  debug?: boolean;
}

function envSet(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * The only function that reads TTY state and the CI, NO_COLOR, FORCE_COLOR and TERM variables. Color
 * precedence: --no-color, then a nonempty NO_COLOR, then FORCE_COLOR ("0" is off), then stderr is a terminal.
 */
export function resolveModes(
  flags: ModeFlags,
  env: NodeJS.ProcessEnv = process.env,
  tty: { stdin: boolean; stderr: boolean } = { stdin: process.stdin.isTTY === true, stderr: process.stderr.isTTY === true }
): Modes {
  const json = flags.json === true;
  const interactive = !flags.nonInteractive && !json && !envSet(env.CI) && tty.stdin && tty.stderr;
  let color = tty.stderr && env.TERM !== "dumb";
  if (env.FORCE_COLOR !== undefined) color = env.FORCE_COLOR !== "0";
  if (flags.noColor || (env.NO_COLOR ?? "") !== "") color = false;
  return { json, interactive, color, debug: flags.debug === true };
}

/** Color marks only the Error: prefix; meaning is always in the text too. */
export function paint(modes: Pick<Modes, "color">, text: string): string {
  return modes.color ? `\u001b[31m${text}\u001b[39m` : text;
}

// Remote and provider text is data: drop control, bidi and zero-width characters before printing.
const unsafeCharacters = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

export function printable(text: string): string {
  return text.replace(unsafeCharacters, "");
}

function commandLine(argv: string[]): string {
  return argv.map((part) => (/^[\w./:@=,+-]+$/.test(part) ? part : JSON.stringify(part))).join(" ");
}

/** Writes one failure to stderr: a single JSON line with --json, otherwise a headline and a hint. */
export function renderError(error: CliError, modes: Modes, write: (line: string) => void): void {
  const message = printable(error.message);
  if (modes.json) {
    const status = error.reason === "action_required" || error.exitCode === exitCodes.usage ? "action_required" : "error";
    write(
      JSON.stringify({
        status,
        reason: error.reason,
        message,
        ...(error.next ? { next: [{ command: commandLine(error.next), argv: error.next }] } : {}),
        ...(error.data ? { data: error.data } : {}),
        ...(error.retryable ? { retryable: true } : {}),
        ...(error.reason === "action_required" ? { userActionRequired: true } : {})
      })
    );
    return;
  }
  const lines = [`${paint(modes, "Error:")} ${message}`];
  if (error.hint) lines.push(error.hint);
  if (error.next) lines.push(`Next: ${commandLine(error.next)}`);
  if (modes.debug) lines.push((error.cause instanceof Error ? error.cause.stack : undefined) ?? error.stack ?? "");
  write(lines.join("\n"));
}

/**
 * The only prompt. `--yes` answers it; without a terminal it never reads stdin and fails as
 * action_required naming --yes; a declined prompt is canceled (exit 130). Prompts go to stderr, default No.
 */
export async function confirm(modes: Modes, question: string, yes: boolean | undefined, command: string[]): Promise<void> {
  if (yes) return;
  if (!modes.interactive) {
    throw new CliError("action_required", `${question} Confirmation is required and this run is non-interactive.`, {
      hint: "Add --yes to confirm without a prompt.",
      next: [...command, "--yes"]
    });
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new CliError("canceled", "Canceled. Nothing was changed.");
  }
}
