#!/usr/bin/env node
// Physical smoke for crash-safe cleanup on the local Docker engine.
//
//   pnpm build && node scripts/gc-docker-smoke.mjs [--image debian:bookworm-slim] [--out <file.json>] [--require]
//
// It starts the built `capsule sandbox` with a private state directory, waits until the labelled
// container exists, and kills the CLI with SIGKILL mid-create. Then `capsule gc` must report that
// container as a residual of an exited run, refuse to remove it without consent, remove it with --yes
// under a fresh grant with a receipt, and see it gone. It never pulls: without an engine or the image the
// run is skipped with the reason, and with --require a skip fails. Whatever the outcome, it removes any
// container carrying the run's job label.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "packages", "cli", "dist", "index.js");
const { values } = parseArgs({
  options: {
    image: { type: "string", default: "debian:bookworm-slim" },
    out: { type: "string" },
    require: { type: "boolean", default: false }
  }
});

function docker(args) {
  const run = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  return { ok: run.status === 0, stdout: run.stdout ?? "", stderr: run.stderr ?? String(run.error?.message ?? "") };
}

function report(record) {
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, text);
  process.stdout.write(text);
}

function skip(reason) {
  report({ harness: "capsule gc docker smoke v1", outcome: "skipped", reason });
  process.exit(values.require ? 1 : 0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (!docker(["version", "--format", "{{.Server.Version}}"]).ok) skip("no reachable docker engine");
if (!docker(["image", "inspect", values.image]).ok) skip(`image ${values.image} is not present and is never pulled`);
if (!existsSync(cli)) skip("packages/cli/dist/index.js is missing; run pnpm build first");

const scratch = mkdtempSync(join(tmpdir(), "capsule-gc-smoke-"));
const env = { ...process.env, CAPSULE_STATE_DIR: join(scratch, "state"), CI: "1" };
const leaseDir = join(scratch, "state", "jobs");
const receipts = join(scratch, "receipts.jsonl");
const capsule = (args) => {
  const run = spawnSync(process.execPath, [cli, ...args], { cwd: scratch, env, encoding: "utf8", timeout: 120_000 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
};
const labelled = (job) =>
  docker(["ps", "-a", "-q", "--no-trunc", "--filter", `label=capsule_job=${job}`])
    .stdout.split(/\s+/)
    .filter(Boolean);

let job;
const checks = {};
try {
  const child = spawn(process.execPath, [cli, "sandbox", "--image", values.image, "--", "sleep", "600"], { cwd: scratch, env, stdio: "ignore" });
  let container;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && container === undefined) {
    const files = existsSync(leaseDir) ? readdirSync(leaseDir).filter((name) => name.endsWith(".json")) : [];
    if (files.length > 0) {
      job ??= JSON.parse(readFileSync(join(leaseDir, files[0]), "utf8")).job;
      container = labelled(job)[0];
    }
    if (container === undefined) await sleep(20);
  }
  if (container === undefined) throw new Error("the sandbox container never appeared");
  child.kill("SIGKILL");
  await new Promise((done) => child.once("exit", done));
  const stateAtKill = docker(["inspect", "--format", "{{.State.Status}}", container]).stdout.trim();
  checks.leaseWrittenBeforeCreate = job !== undefined;
  checks.killLeftContainer = labelled(job).includes(container);

  const scan = capsule(["gc", "--dry-run", "--json"]);
  const scanned = JSON.parse(scan.stdout);
  checks.gcFindsResidual =
    scan.status === 0 && scanned.residuals.some((entry) => entry.resource.id === container && entry.verdict === "exited" && entry.resource.job === job);

  const refused = capsule(["gc", "--json"]);
  checks.removalNeedsConsent = refused.status === 2 && labelled(job).includes(container);

  const removed = capsule(["gc", "--yes", "--json", "--reason", "gc smoke", "--receipt-file", receipts]);
  const result = JSON.parse(removed.stdout || "{}").results?.find((entry) => entry.resource.id === container);
  const written = existsSync(receipts)
    ? readFileSync(receipts, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  checks.removedUnderFreshGrant = removed.status === 0 && result?.outcome === "removed" && /^gc_/.test(result?.approval ?? "");
  checks.receiptForRemoval = written.some(
    (receipt) =>
      receipt.type === "sandbox.destroy" && receipt.resource?.id === container && receipt.metadata?.gc === "exited" && result?.receipts?.includes(receipt.id)
  );
  checks.observedGone = labelled(job).length === 0;
  checks.leaseForgotten = !existsSync(join(leaseDir, `${job}.json`));
  const passed = Object.values(checks).every(Boolean);
  report({ harness: "capsule gc docker smoke v1", outcome: passed ? "passed" : "failed", image: values.image, stateAtKill, checks });
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  report({ harness: "capsule gc docker smoke v1", outcome: "failed", error: String(error?.message ?? error), checks });
  process.exitCode = 1;
} finally {
  if (job) for (const id of labelled(job)) docker(["rm", "-f", id]);
  rmSync(scratch, { recursive: true, force: true });
}
