// Exercises the real runDocker child-process plumbing against a fake `docker` executable placed first
// on PATH. No Docker daemon is used.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
