// Exercises the real runDocker child-process plumbing against a fake `docker` executable placed first
// on PATH. No Docker daemon is used.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaptureLimitError, defaultCaptureBounds } from "@capsule-sdk/core";
import { runDocker } from "./docker-cli.js";

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
});
