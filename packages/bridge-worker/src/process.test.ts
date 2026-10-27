import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { decodeBody, FrameReader } from "./frame.js";
import { frameOf, readFixture } from "./harness.test.support.js";
import { MAX_FRAME_BYTES } from "./wire.js";

// The worker as a real child process on stdio, from source through tsx so it runs before a build.
// The packed artifact gets the same checks in scripts/package-pack-smoke.mjs.

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const bin = join(repoRoot, "packages", "bridge-worker", "src", "bin.ts");
const hello = readFixture<{ message: Record<string, unknown> }>("cases/hello_valid.json").message;
const state = readFixture<{ provider_state: Record<string, unknown> }>("scenarios/create_exec_destroy.json").provider_state;
const scratch: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Worker {
  child: ChildProcessWithoutNullStreams;
  next(): Promise<Record<string, unknown>>;
  exit: Promise<number | null>;
  stdoutBytes(): number;
  stderr(): string;
}

function spawnWorker(config: Record<string, unknown>): Worker {
  const dir = mkdtempSync(join(tmpdir(), "capsule-bridge-proc-"));
  scratch.push(dir);
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  const child = spawn(process.execPath, ["--import", "tsx", bin, "--profile", "fixture", "--config", configPath], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH ?? "", TSX_TSCONFIG_PATH: join(repoRoot, "tsconfig.typecheck.json") },
    stdio: ["pipe", "pipe", "pipe"]
  });
  children.push(child);
  const reader = new FrameReader(() => MAX_FRAME_BYTES);
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  let bytes = 0;
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    reader.push(chunk);
    for (let body = reader.next(); body; body = reader.next()) {
      const message = decodeBody(body);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    exit,
    next: () => {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no frame from the worker; stderr: ${stderr}`)), 15_000);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    stdoutBytes: () => bytes,
    stderr: () => stderr
  };
}

const owned = { native_id: "fx-key-create-1", project: "proj-1", owner_job: "01K8W3A00000000000000000J1", status: "ready" };
const exec = readFixture<{ message: Record<string, unknown> }>("cases/request_exec_valid.json").message;

describe("worker process on stdio", () => {
  test("a governed create, exec and destroy round trip, then a clean exit on end of input", async () => {
    const worker = spawnWorker(state);
    worker.child.stdin.write(frameOf(hello));
    expect(await worker.next()).toMatchObject({ type: "hello_ack", protocol: 1 });
    worker.child.stdin.write(frameOf(readFixture<{ message: object }>("cases/request_create_valid.json").message));
    expect(await worker.next()).toMatchObject({ type: "result", state: "completed", resource: { native_id: "fx-key-create-1" } });
    worker.child.stdin.write(frameOf(exec));
    expect(await worker.next()).toMatchObject({ type: "result", output: { exit_code: 0, stdout: { text: "hi\n" } } });
    worker.child.stdin.write(frameOf(readFixture<{ message: object }>("cases/request_destroy_valid.json").message));
    expect(await worker.next()).toMatchObject({ type: "result", output: { status: "destroyed" } });
    worker.child.stdin.end();
    expect(await worker.exit).toBe(0);
  }, 30_000);

  test("an oversize hello is refused from its length prefix while stdin stays open", async () => {
    const worker = spawnWorker(state);
    worker.child.stdin.write(Buffer.from(readFixture<{ hex: string }>("frames/hello_oversize.json").hex, "hex"));
    expect(await worker.next()).toMatchObject({ type: "protocol_error", code: "oversize" });
    expect(await worker.exit).toBe(2);
  }, 30_000);

  test("end of input with an exec in flight answers pending, cancels nothing and exits 0", async () => {
    const worker = spawnWorker({
      ...state,
      sandboxes: [owned],
      script: [{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_cancelled" }]
    });
    worker.child.stdin.write(frameOf(hello));
    await worker.next();
    worker.child.stdin.write(frameOf(exec));
    expect(await worker.next()).toMatchObject({ type: "progress", seq: 1 });
    worker.child.stdin.end();
    expect(await worker.next()).toMatchObject({ type: "error", request_id: "r-2", error: { code: "pending", reason: "shutting_down", effect: "pending" } });
    expect(await worker.exit).toBe(0);
  }, 30_000);

  test("SIGTERM drains like a shutdown and exits 0", async () => {
    const worker = spawnWorker({
      ...state,
      sandboxes: [owned],
      script: [{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_cancelled" }]
    });
    worker.child.stdin.write(frameOf(hello));
    await worker.next();
    worker.child.stdin.write(frameOf(exec));
    await worker.next();
    worker.child.kill("SIGTERM");
    expect(await worker.next()).toMatchObject({ type: "error", error: { code: "pending", reason: "shutting_down" } });
    expect(await worker.exit).toBe(0);
  }, 30_000);

  test("a bad config fails before any frame is read, with a diagnostic on stderr only", async () => {
    const worker = spawnWorker({ binding: { account: "a" } });
    expect(await worker.exit).toBe(2);
    expect(worker.stdoutBytes()).toBe(0);
    expect(worker.stderr()).toContain("binding keys");
  }, 30_000);
});
