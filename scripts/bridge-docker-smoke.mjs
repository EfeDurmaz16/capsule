#!/usr/bin/env node
// Physical smoke for the bridge worker's Docker profile (draft P12 layer L3) on the local engine.
//
//   pnpm build && node scripts/bridge-docker-smoke.mjs [--image debian:bookworm-slim] [--execs 20] [--out <file.json>] [--require]
//
// It spawns the built capsule-bridge-worker with --profile docker and drives it over its pipes:
// a refusal before effect, a missing image that must not be pulled, create, exec, a worker kill and
// respawn that must find the same container by label, destroy, and a check that nothing is left. It
// never pulls an image: the image must already be present, or the run is skipped with the reason.
// With --require, as in CI, a skip fails the run: no reachable engine or no image is not a pass.
// Raw timings (spawn to hello_ack, each round trip) are written as JSON. Every container it makes
// carries a per-run fabric.job label, and the run removes any such container it left behind.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { expect, hello, startWorker } from "./bridge-worker-client.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    image: { type: "string", default: "debian:bookworm-slim" },
    execs: { type: "string", default: "20" },
    out: { type: "string" },
    require: { type: "boolean", default: false }
  }
});
const image = values.image;
const execCount = Number(values.execs);

function docker(args) {
  try {
    return { ok: true, stdout: execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }) };
  } catch (error) {
    return { ok: false, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? error.message) };
  }
}

function report(record) {
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, text);
  process.stdout.write(text);
}

const meta = {
  harness: "capsule bridge worker docker smoke v1",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  date: new Date().toISOString(),
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? "unknown" },
  node: process.version,
  image
};

const version = docker(["version", "--format", "{{.Server.Version}}"]);
// A skip passes a local run and fails a required one.
const skipped = values.require ? 1 : 0;
if (!version.ok) {
  report({ ...meta, outcome: "skipped", reason: "Docker daemon is not reachable", detail: version.stderr?.trim().slice(0, 300) });
  process.exit(skipped);
}
if (!docker(["image", "inspect", image]).ok) {
  report({ ...meta, outcome: "skipped", reason: `image ${image} is not present locally and the smoke never pulls` });
  process.exit(skipped);
}
const missingImage = `capsule-bridge-smoke-missing:${randomBytes(4).toString("hex")}`;
expect(!docker(["image", "inspect", missingImage]).ok, "the deliberately missing image exists");

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulid = () => `0${Array.from(randomBytes(25), (byte) => crockford[byte % 32]).join("")}`;
const job = ulid();
const scope = { job, task: ulid(), attempt: ulid(), generation: "1" };
let counter = 0;
const request = (action, fields, operation) => {
  counter += 1;
  return {
    type: "request",
    request_id: `r-${counter}`,
    operation: operation ?? { id: ulid(), key: `smoke-${action}-${counter}`, digest: randomBytes(32).toString("hex") },
    scope,
    action,
    ...fields,
    approval: fields.approval ?? null,
    deadline_ms: 60_000
  };
};

const scratch = mkdtempSync(join(tmpdir(), "capsule-bridge-docker-smoke-"));
const configPath = join(scratch, "config.json");
const receiptsPath = join(scratch, "receipts.jsonl");
writeFileSync(
  configPath,
  JSON.stringify({ policy: { images: [image, missingImage] }, approvals: [{ ref: "apr-smoke-destroy", action: "sandbox.destroy", native_id: null }] })
);
const bin = join(repoRoot, "packages", "bridge-worker", "dist", "bin.js");
const spawnWorker = () =>
  startWorker({
    command: process.execPath,
    args: [bin, "--profile", "docker", "--config", configPath, "--receipts", receiptsPath],
    cwd: scratch,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? scratch, ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) },
    timeoutMs: 90_000
  });

const ownContainers = () =>
  docker(["ps", "-a", "-q", "--no-trunc", "--filter", `label=fabric.job=${job}`])
    .stdout.split(/\s+/)
    .filter(Boolean);

async function roundTrip(worker, message) {
  const started = performance.now();
  worker.send(message);
  const answer = await worker.next();
  return { answer, ms: performance.now() - started };
}

const timings = { spawnToHelloAckMs: [], createMs: null, execMs: [], destroyMs: null, deniedMs: null, missingImageMs: null, replayCreateMs: null };
const checks = {};
try {
  let worker = spawnWorker();
  worker.send(hello("docker"));
  const ack = await worker.next();
  expect(ack.type === "hello_ack" && ack.profile.profile === "docker", `no docker hello_ack: ${JSON.stringify(ack)}`);
  timings.spawnToHelloAckMs.push(ack.receivedAtMs);

  const denied = await roundTrip(worker, request("sandbox.create", { params: { image: "capsule-not-allowed:latest", env: {}, secret_names: [], labels: {} } }));
  timings.deniedMs = denied.ms;
  checks.deniedBeforeEffect =
    denied.answer.type === "error" && denied.answer.error.code === "denied" && denied.answer.error.effect === "none" && ownContainers().length === 0;

  const missing = await roundTrip(worker, request("sandbox.create", { params: { image: missingImage, env: {}, secret_names: [], labels: {} } }));
  timings.missingImageMs = missing.ms;
  checks.missingImageNotPulled =
    missing.answer.type === "error" &&
    missing.answer.error.code === "provider_failed" &&
    missing.answer.error.effect === "none" &&
    !docker(["image", "inspect", missingImage]).ok &&
    ownContainers().length === 0;

  const createOperation = { id: ulid(), key: "smoke-create-main", digest: randomBytes(32).toString("hex") };
  const created = await roundTrip(
    worker,
    request("sandbox.create", { params: { image, env: { SMOKE: "1" }, secret_names: [], labels: { purpose: "capsule-bridge-smoke" } } }, createOperation)
  );
  timings.createMs = created.ms;
  expect(created.answer.type === "result" && created.answer.state === "completed", `create failed: ${JSON.stringify(created.answer)}`);
  const resource = created.answer.resource;
  const labels = JSON.parse(docker(["inspect", "--format", "{{json .Config.Labels}}", resource.native_id]).stdout);
  const engine = docker(["context", "show"]).stdout.trim();
  checks.locatorScope = resource.provider === "docker" && resource.kind === "container" && resource.scope.engine === engine;
  checks.labels =
    labels["fabric.operation"] === createOperation.id &&
    labels["fabric.job"] === job &&
    labels["fabric.attempt"] === scope.attempt &&
    labels["fabric.generation"] === "1";
  checks.receiptListed = created.answer.receipts.length === 1 && created.answer.receipts[0].algorithm === "sha256";

  let execOk = true;
  for (let index = 0; index < execCount; index += 1) {
    const executed = await roundTrip(
      worker,
      request("sandbox.exec", {
        target: resource,
        params: { argv: ["echo", `bridge-${index}`], stdin: null, cwd: null, timeout_ms: 30_000, max_output_bytes: 4096, secret_names: [] }
      })
    );
    timings.execMs.push(executed.ms);
    execOk &&= executed.answer.type === "result" && executed.answer.output.exit_code === 0 && executed.answer.output.stdout.text === `bridge-${index}\n`;
  }
  checks.execOutput = execOk;

  // Worker loss: kill it, spawn a new one, send the same create. The label query must find the same
  // container, with no second container and no second docker create.
  worker.child.kill("SIGKILL");
  await worker.exit;
  checks.workerKillLeftContainerRunning = docker(["inspect", "--format", "{{.State.Running}}", resource.native_id]).stdout.trim() === "true";
  worker = spawnWorker();
  worker.send(hello("docker"));
  const secondAck = await worker.next();
  timings.spawnToHelloAckMs.push(secondAck.receivedAtMs);
  const replay = await roundTrip(
    worker,
    request("sandbox.create", { params: { image, env: { SMOKE: "1" }, secret_names: [], labels: { purpose: "capsule-bridge-smoke" } } }, createOperation)
  );
  timings.replayCreateMs = replay.ms;
  checks.restartFindsSameContainer =
    replay.answer.type === "result" &&
    replay.answer.replayed === true &&
    replay.answer.resource.native_id === resource.native_id &&
    ownContainers().length === 1;

  const noApproval = await roundTrip(worker, request("sandbox.destroy", { target: resource, params: {} }));
  checks.destroyNeedsFreshApproval =
    noApproval.answer.type === "error" && noApproval.answer.error.reason === "approval_required" && ownContainers().length === 1;
  const destroyed = await roundTrip(worker, request("sandbox.destroy", { target: resource, params: {}, approval: { ref: "apr-smoke-destroy" } }));
  timings.destroyMs = destroyed.ms;
  checks.destroyObservedGone = destroyed.answer.type === "result" && destroyed.answer.output.status === "destroyed" && ownContainers().length === 0;

  worker.end();
  checks.cleanExitOnEndOfInput = (await worker.exit).code === 0;
  const passed = Object.values(checks).every(Boolean);
  const sorted = [...timings.execMs].sort((left, right) => left - right);
  report({
    ...meta,
    outcome: passed ? "passed" : "failed",
    dockerServer: version.stdout.trim(),
    engine,
    checks,
    summary: { execP50Ms: sorted[Math.floor(sorted.length * 0.5)], execP95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] },
    raw: timings
  });
  process.exitCode = passed ? 0 : 1;
} finally {
  const leftovers = ownContainers();
  if (leftovers.length > 0) docker(["rm", "-f", ...leftovers]);
  rmSync(scratch, { recursive: true, force: true });
}
