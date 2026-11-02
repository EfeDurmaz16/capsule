import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const strays: number[] = [];

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
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

function spawnWorker(
  config: Record<string, unknown>,
  options: { profile?: string; path?: string; env?: Record<string, string>; ownGroup?: boolean } = {}
): Worker {
  const dir = mkdtempSync(join(tmpdir(), "capsule-bridge-proc-"));
  scratch.push(dir);
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  const child = spawn(process.execPath, ["--import", "tsx", bin, "--profile", options.profile ?? "fixture", "--config", configPath], {
    cwd: repoRoot,
    env: { PATH: options.path ?? process.env.PATH ?? "", TSX_TSCONFIG_PATH: join(repoRoot, "tsconfig.typecheck.json"), ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    // As Fabric starts it: the leader of a process group of its own.
    ...(options.ownGroup ? { detached: true } : {})
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

const owned = {
  native_id: "fx-key-create-1",
  project: "proj-1",
  owner_job: "01K8W3A00000000000000000J1",
  operation: "01K8W3A00000000000000000P1",
  status: "ready"
};
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

// A stand-in docker CLI for the Docker profile: enough of context, version, inspect and exec for one
// governed exec. Its exec records its pid and then runs for two minutes, like a long command whose
// docker exec client stays attached. Its create records its pid, takes a second, as a daemon's answer
// can, and records that it finished.
const fakeDocker = `#!/bin/sh
case "$1" in --context=*) shift ;; esac
case "$1" in
  context) echo fake-engine ;;
  version) echo 29.0.0 ;;
  inspect)
    case "$*" in
      *Created*) echo 2026-10-27T10:00:00Z ;;
      *) printf '%s\\t%s\\n' '{"Status":"running","Running":true}' '{"fabric.job":"01K8W3A00000000000000000J1"}' ;;
    esac ;;
  exec) echo $$ > "$FAKE_DOCKER_PIDS/exec.pid"; exec sleep 120 ;;
  ps) ;;
  create)
    echo $$ > "$FAKE_DOCKER_PIDS/create.pid"
    sleep 1
    echo finished > "$FAKE_DOCKER_PIDS/create.done"
    echo cccccccccccc ;;
  *) echo "fake docker: unexpected $*" >&2; exit 1 ;;
esac
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 20))) if (check()) return true;
  return check();
}

describe.skipIf(process.platform === "win32")("docker CLI clients when the worker exits", () => {
  for (const ending of ["end of input", "SIGTERM"] as const) {
    test(`a docker exec client still attached is killed on ${ending}; the exec is answered pending`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "capsule-bridge-fake-docker-"));
      scratch.push(dir);
      writeFileSync(join(dir, "docker"), fakeDocker, { mode: 0o755 });
      const worker = spawnWorker(
        { binding: { engine: "fake-engine" }, policy: {}, approvals: [] },
        { profile: "docker", path: `${dir}:${process.env.PATH ?? ""}`, env: { FAKE_DOCKER_PIDS: dir } }
      );
      worker.child.stdin.write(frameOf({ ...hello, profile: "docker" }));
      expect(await worker.next()).toMatchObject({ type: "hello_ack" });
      worker.child.stdin.write(
        frameOf({
          ...exec,
          target: { provider: "docker", scope: { engine: "fake-engine" }, kind: "container", native_id: "c1" },
          params: { argv: ["sleep", "120"], stdin: null, cwd: null, timeout_ms: 60_000, max_output_bytes: 1024, secret_names: [] },
          deadline_ms: 600_000
        })
      );
      const pidFile = join(dir, "exec.pid");
      expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 15_000)).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8"));
      strays.push(pid);
      expect(alive(pid)).toBe(true);
      if (ending === "SIGTERM") worker.child.kill("SIGTERM");
      else worker.child.stdin.end();
      expect(await worker.next()).toMatchObject({ type: "error", request_id: "r-2", error: { code: "pending", reason: "shutting_down", state: "running" } });
      expect(await worker.exit).toBe(0);
      // Killing the client does not stop the command in a real daemon; it only frees the host process.
      expect(await until(() => !alive(pid), 2_000)).toBe(true);
    }, 30_000);
  }

  test("a docker create client in flight finishes when the worker's process group is killed", async () => {
    // Fabric ends a lost worker's process group with SIGKILL. Killing a create client could abort the
    // daemon's work, so the worker starts it outside its group, and it ends when the daemon answers.
    const dir = mkdtempSync(join(tmpdir(), "capsule-bridge-fake-docker-"));
    scratch.push(dir);
    writeFileSync(join(dir, "docker"), fakeDocker, { mode: 0o755 });
    const worker = spawnWorker(
      { binding: { engine: "fake-engine" }, policy: { images: ["debian:bookworm-slim"] }, approvals: [] },
      { profile: "docker", path: `${dir}:${process.env.PATH ?? ""}`, env: { FAKE_DOCKER_PIDS: dir }, ownGroup: true }
    );
    worker.child.stdin.write(frameOf({ ...hello, profile: "docker" }));
    expect(await worker.next()).toMatchObject({ type: "hello_ack" });
    const create = readFixture<{ message: Record<string, unknown> }>("cases/request_create_valid.json").message;
    worker.child.stdin.write(frameOf({ ...create, params: { image: "debian:bookworm-slim", env: {}, secret_names: [], labels: {} } }));
    const pidFile = join(dir, "create.pid");
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 15_000)).toBe(true);
    strays.push(Number(readFileSync(pidFile, "utf8")));
    process.kill(-worker.child.pid!, "SIGKILL");
    expect(await worker.exit).toBeNull();
    expect(await until(() => existsSync(join(dir, "create.done")), 5_000)).toBe(true);
  }, 30_000);
});
