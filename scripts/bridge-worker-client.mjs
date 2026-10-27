// A minimal bridge protocol v1 client for smoke checks and measurements of the capsule-bridge-worker
// process: it spawns the worker, writes u32 little-endian length-prefixed JSON frames to its stdin
// and reads frames from its stdout. It is deliberately independent of the worker's own code, so a
// smoke run checks the artifact through the wire alone.
import { spawn } from "node:child_process";

const MAX_FRAME = 16 << 20;

export function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
}

/**
 * Spawns a worker. `command` and `args` start it; `env` is its whole environment. Returns helpers to
 * send frames, await the next decoded frame, and await the exit status.
 */
export function startWorker({ command, args, cwd, env, timeoutMs = 20_000 }) {
  const spawnedAt = performance.now();
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let buffered = Buffer.alloc(0);
  let stdoutBytes = 0;
  let stderr = "";
  const queue = [];
  const waiters = [];
  const deliver = (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else queue.push(message);
  };
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME) {
        deliver({ type: "client_error", message: `bad frame length ${length}` });
        buffered = Buffer.alloc(0);
        return;
      }
      if (buffered.length < 4 + length) return;
      const body = buffered.subarray(4, 4 + length);
      buffered = buffered.subarray(4 + length);
      deliver({ ...JSON.parse(body.toString("utf8")), receivedAtMs: performance.now() - spawnedAt });
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const exit = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  exit.then(() => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`worker exited before answering; stderr: ${stderr.slice(-2000)}`));
  });
  return {
    child,
    exit,
    spawnedAt,
    send(message) {
      child.stdin.write(frame(message));
    },
    sendBytes(bytes) {
      child.stdin.write(bytes);
    },
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no frame within ${timeoutMs} ms; stderr: ${stderr.slice(-2000)}`)), timeoutMs);
        waiters.push({
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    },
    end() {
      child.stdin.end();
    },
    stdoutBytes: () => stdoutBytes,
    stderr: () => stderr
  };
}

export const hello = (profile) => ({
  type: "hello",
  versions: { min: 1, max: 1 },
  fabric: "fabric/0.1.0",
  profile,
  limits: { max_request_bytes: 1048576, max_frame_bytes: 16777216, max_in_flight: 8, max_stderr_bytes: 65536 }
});

export const scope = { job: "01K8W3A00000000000000000J1", task: "01K8W3A00000000000000000T1", attempt: "01K8W3A00000000000000000A1", generation: "1" };

/** A request with a fresh operation id and key derived from `n`. */
export function request(n, action, fields) {
  const suffix = String(n).padStart(6, "0");
  return {
    type: "request",
    request_id: `r-${n}`,
    operation: { id: `01K8W3A0000000000000${suffix}`, key: `key-${action}-${n}`, digest: n.toString(16).padStart(64, "0") },
    scope,
    action,
    ...fields,
    approval: fields.approval ?? null,
    deadline_ms: fields.deadline_ms ?? 30000
  };
}

export function expect(condition, message) {
  if (!condition) throw new Error(message);
}
