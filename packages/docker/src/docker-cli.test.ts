// Exercises the real runDocker child-process plumbing against a fake `docker` executable placed first
// on PATH. No Docker daemon is used.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Capsule, CaptureLimitError, defaultCaptureBounds, UnknownOutcomeError } from "@capsule-sdk/core";
import { runDocker } from "./docker-cli.js";
import { docker } from "./index.js";

let binDir: string;
let originalPath: string | undefined;

function fakeDocker(script: string): void {
  const path = join(binDir, "docker");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), "capsule-fake-docker-"));
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(binDir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("runDocker", () => {
  it("SB-08: writes input to stdin and closes it so the command sees EOF", async () => {
    fakeDocker("cat");
    await expect(runDocker(["exec", "-i", "c", "cat"], { input: "hello\n", timeoutMs: 5_000 })).resolves.toMatchObject({ exitCode: 0, stdout: "hello\n" });
    await expect(runDocker(["exec", "-i", "c", "cat"], { input: "", timeoutMs: 5_000 })).resolves.toMatchObject({ exitCode: 0, stdout: "" });
  });

  it("GAP-01: a timeout kills the local CLI and marks the result as timed out", async () => {
    fakeDocker("sleep 5");
    const started = Date.now();
    const result = await runDocker(["run", "image"], { timeoutMs: 100 });
    expect(result).toMatchObject({ exitCode: 124, timedOut: true });
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("an abort kills the local CLI at once and rejects with the abort reason", async () => {
    fakeDocker('echo $$ > "$0.pid"; exec sleep 30');
    const controller = new AbortController();
    const started = Date.now();
    const running = runDocker(["exec", "c", "sleep", "30"], { timeoutMs: 60_000, signal: controller.signal });
    for (let tries = 0; tries < 200 && !existsSync(join(binDir, "docker.pid")); tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const pid = Number(readFileSync(join(binDir, "docker.pid"), "utf8"));
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    // The rejection comes as the kill is sent; give the process a moment to be reaped.
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let tries = 0; tries < 200 && alive(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(alive()).toBe(false);
    expect(Date.now() - started).toBeLessThan(4_000);
    rmSync(join(binDir, "docker.pid"), { force: true });
  });

  it("GAP-01: a command that exits 124 by itself is not a timeout", async () => {
    fakeDocker("exit 124");
    const result = await runDocker(["run", "image"], { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBeUndefined();
  });

  it("PERF-10: caps captured output while draining the rest so the command completes", async () => {
    fakeDocker("head -c 3145728 /dev/zero | tr '\\000' a; echo done >&2");
    const bounds = { ...defaultCaptureBounds, maxBytes: 1024, deadlineMs: Number.MAX_SAFE_INTEGER };
    const result = await runDocker(["exec", "c", "big"], { timeoutMs: 10_000, outputBounds: { stdout: bounds, stderr: bounds } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a".repeat(1024));
    expect(result.stderr).toBe("done\n");
    expect(result.truncation).toEqual({
      stdout: { truncated: true, reason: "bytes", capturedBytes: 1024, limit: 1024 },
      stderr: { truncated: false, capturedBytes: 5 }
    });
  });

  it("PERF-10: never splits a multibyte character at the cap", async () => {
    fakeDocker("printf 'ééé'");
    const bounds = { ...defaultCaptureBounds, maxBytes: 3, deadlineMs: Number.MAX_SAFE_INTEGER };
    const result = await runDocker(["exec", "c", "x"], { timeoutMs: 5_000, outputBounds: { stdout: bounds, stderr: bounds } });
    expect(result.stdout).toBe("é");
    expect(result.truncation?.stdout).toMatchObject({ truncated: true, capturedBytes: 2 });
  });

  it("PERF-10: overflow error rejects with CaptureLimitError after the command exits", async () => {
    fakeDocker("printf 'abcdef'");
    const bounds = { ...defaultCaptureBounds, maxBytes: 2, deadlineMs: Number.MAX_SAFE_INTEGER, overflow: "error" as const };
    await expect(runDocker(["exec", "c", "x"], { timeoutMs: 5_000, outputBounds: { stdout: bounds, stderr: bounds } })).rejects.toBeInstanceOf(
      CaptureLimitError
    );
  });
  it("PERF-10: a timeout wins over a capture-limit error, so the caller learns the process may still run", async () => {
    fakeDocker("printf 'abcdef'; sleep 5");
    const bounds = { ...defaultCaptureBounds, maxBytes: 2, overflow: "error" as const, deadlineMs: Number.MAX_SAFE_INTEGER };
    const result = await runDocker(["exec", "c", "x"], { timeoutMs: 300, outputBounds: { stdout: bounds, stderr: bounds } });
    expect(result).toMatchObject({ exitCode: 124, timedOut: true, timeoutNote: "Command timed out after 300ms" });
    expect(result.captureLimit).toBeInstanceOf(CaptureLimitError);
    expect(result.truncation?.stdout).toMatchObject({ truncated: true, reason: "bytes", limit: 2 });

    // Through the adapter the same run is an unknown outcome, not a capture-limit error.
    const adapter = docker({
      checkAvailable: async () => true,
      runner: (args, options) =>
        args[0] === "exec" ? runDocker(args, options) : Promise.resolve({ exitCode: 0, stdout: args[0] === "create" ? "box-1\n" : "", stderr: "" })
    });
    const box = await new Capsule({ adapter }).sandbox.create({});
    const error = await box.exec({ command: "x", timeoutMs: 300, bounds: { maxBytes: 2, overflow: "error" } }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(UnknownOutcomeError);
  });

  it("PERF-10: a secret cut by the stderr cap is redacted even when the timeout note follows it", async () => {
    // run and exec print the secret and hang; ps (used to reap the timed-out job) finds no container.
    fakeDocker(`case "$1" in run|exec) printf 'xxxxxxxxxxSUPERSECRETVALUE' >&2; sleep 5 ;; *) ;; esac`);
    const policy = { limits: { maxStderrBytes: 15 }, secrets: { allowed: ["TOKEN"], redactFromLogs: true } };
    const env = { TOKEN: "SUPERSECRETVALUE" };
    const run = await new Capsule({ adapter: docker({ checkAvailable: async () => true }), receipts: true, policy }).job.run({
      image: "img",
      command: "x",
      env,
      timeoutMs: 300
    });
    const stderr = run.result?.stderr ?? "";
    expect(stderr).not.toContain("SUPER");
    expect(stderr.startsWith("xxxxxxxxxx[REDACTED]\nCommand timed out after 300ms")).toBe(true);
    expect(JSON.stringify(run.receipt)).not.toContain("SUPER");

    const adapter = docker({
      checkAvailable: async () => true,
      runner: (args, options) =>
        args[0] === "exec" ? runDocker(args, options) : Promise.resolve({ exitCode: 0, stdout: args[0] === "create" ? "box-1\n" : "", stderr: "" })
    });
    const box = await new Capsule({ adapter, policy }).sandbox.create({});
    const error = (await box.exec({ command: "x", env, timeoutMs: 300 }).catch((caught: unknown) => caught)) as UnknownOutcomeError;
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    const cause = error.cause as { cause?: { stderr?: string } } & { stderr?: string };
    const serialized = JSON.stringify({ cause, inner: (cause as { cause?: unknown }).cause });
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("SUPER");
  });
});
