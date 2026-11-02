#!/usr/bin/env node
// Proves a built capsule-bridge-worker executable (scripts/build-bridge-worker-sea.mjs) on its own:
//
//   pnpm bridge:artifact-smoke [--artifact <path>] [--out <file.json>]
//
// The artifact is copied into a fresh directory outside the repository and run there with a PATH
// that holds no Node, Bun, pnpm, npm or Deno, and no NODE_PATH. Over its stdio, with this repository's
// independent frame client, it must then pass:
//   - every shared scenario in protocol/bridge/v1/scenarios, compared exactly except message strings.
//     provider_calls, sandbox and journal steps belong to the in-process runs, and a scenario stops at
//     its `advance`, because settling is the in-process fixture provider's;
//   - every Fabric-to-worker frame fixture that must be refused: one protocol_error and exit 2;
//   - SIGTERM with an exec in flight: the exec answered pending/shutting_down, exit 0; SIGINT idle: exit 0;
//   - clean diagnostics: no runtime warning on stderr, and stderr within the negotiated budget.
// A help-only run is not a proof; this drives governed actions and refusals through the binary.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { expect, frame, startWorker } from "./bridge-worker-client.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(repoRoot, "protocol", "bridge", "v1");
const readFixture = (path) => JSON.parse(readFileSync(join(fixtures, path), "utf8"));
const RUNTIMES = ["node", "nodejs", "bun", "pnpm", "npm", "npx", "deno"];

/** What scenario comparison ignores: message strings, and the client's own arrival time. */
export function comparable(message) {
  const copy = structuredClone(message);
  delete copy.receivedAtMs;
  if (copy.type === "error" && copy.error && typeof copy.error === "object") delete copy.error.message;
  if (copy.type === "protocol_error") delete copy.message;
  return copy;
}

/** Whether `bytes` start like a native executable (ELF, Mach-O or PE), not a script for a runtime. */
export function isNativeExecutable(bytes) {
  if (bytes.length < 4) return false;
  const magic = bytes.readUInt32BE(0);
  return magic === 0x7f454c46 || magic === 0xcffaedfe || magic === 0xfeedfacf || magic === 0xcafebabe || bytes.subarray(0, 2).toString("latin1") === "MZ";
}

/** Runtimes a shell finds on `path`, by `command -v`. Empty when none is reachable. */
export function runtimesOnPath(path) {
  const found = spawnSync("/bin/sh", ["-c", RUNTIMES.map((name) => `command -v ${name}`).join("; ")], {
    env: { PATH: path },
    encoding: "utf8"
  });
  return found.stdout.split("\n").filter(Boolean);
}

async function main() {
  const { values } = parseArgs({ options: { artifact: { type: "string" }, out: { type: "string" } } });
  const source = resolve(values.artifact ?? join(repoRoot, "packages", "bridge-worker", "sea", "capsule-bridge-worker"));
  const bytes = readFileSync(source);
  expect(isNativeExecutable(bytes), `${source} is not a native executable; a script would need a runtime on PATH`);

  const scratch = mkdtempSync(join(tmpdir(), "capsule-bridge-artifact-"));
  const binDir = join(scratch, "bin");
  const emptyPath = join(scratch, "empty-path");
  mkdirSync(binDir);
  mkdirSync(emptyPath);
  const artifact = join(binDir, "capsule-bridge-worker");
  copyFileSync(source, artifact);
  chmodSync(artifact, 0o755);
  // The whole environment: no runtime on PATH, no NODE_PATH, HOME inside the scratch directory.
  const env = { PATH: emptyPath, HOME: scratch };
  expect(runtimesOnPath(env.PATH).length === 0, `a runtime is reachable on the smoke PATH: ${runtimesOnPath(env.PATH).join(", ")}`);

  const hello = readFixture("cases/hello_valid.json").message;
  const helloAck = readFixture("cases/hello_ack_valid.json").message;
  const stderrBudget = hello.limits.max_stderr_bytes;
  const stderrs = [];
  const spawnWorker = (args) => {
    const worker = startWorker({ command: artifact, args, cwd: scratch, env, timeoutMs: 20_000 });
    stderrs.push(worker);
    return worker;
  };
  const writeConfig = (name, state) => {
    const path = join(scratch, `${name}.config.json`);
    writeFileSync(path, JSON.stringify(state));
    return path;
  };

  const report = {
    harness: "capsule bridge worker artifact smoke v1",
    artifact: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
    host: { platform: process.platform, arch: process.arch },
    path: "an empty directory; no node, nodejs, bun, pnpm, npm, npx or deno reachable",
    version: "",
    scenarios: [],
    frames: [],
    signals: {},
    stderr: {}
  };
  try {
    const version = spawnSync(artifact, ["--version"], { cwd: scratch, env, encoding: "utf8" });
    expect(version.status === 0 && version.stderr.startsWith("capsule-worker/"), `--version failed: ${version.status} ${version.stderr}`);
    report.version = version.stderr.trim();

    // 1. Every shared scenario over the artifact's stdio.
    for (const file of readdirSync(join(fixtures, "scenarios")).sort()) {
      const scenario = readFixture(`scenarios/${file}`);
      const config = writeConfig(scenario.scenario, scenario.provider_state);
      const start = () => spawnWorker(["--profile", scenario.profile, "--config", config]);
      let worker = start();
      const steps = [...scenario.steps];
      if (steps[0]?.handshake === false) {
        steps.shift();
      } else {
        worker.send(hello);
        const ack = await worker.next();
        expect(isDeepStrictEqual(comparable(ack), helloAck), `${scenario.scenario}: hello_ack differs from the fixture`);
      }
      let outbox = [];
      const flush = () => {
        if (outbox.length > 0) worker.sendBytes(Buffer.concat(outbox.map((message) => frame(message))));
        outbox = [];
      };
      let exited = false;
      let stoppedAt;
      let compared = 0;
      for (const [index, step] of steps.entries()) {
        if ("send" in step) {
          outbox.push(step.send);
          continue;
        }
        flush();
        const where = `${scenario.scenario} step ${index}`;
        if ("receive" in step) {
          const message = await worker.next();
          expect(
            isDeepStrictEqual(comparable(message), comparable(step.receive)),
            `${where}: got ${JSON.stringify(comparable(message))}, want ${JSON.stringify(comparable(step.receive))}`
          );
          compared += 1;
        } else if ("advance" in step) {
          stoppedAt = index;
          break;
        } else if ("kill_worker" in step) {
          worker.child.kill(step.kill_worker);
          await worker.exit;
        } else if ("respawn" in step) {
          worker = start();
        } else if ("worker_exit" in step) {
          const { code } = await worker.exit;
          expect(code === step.worker_exit, `${where}: exit ${code}, want ${step.worker_exit}`);
          exited = true;
        } else if (!("provider_calls" in step || "journal" in step || "sandbox" in step)) {
          throw new Error(`${where}: unknown step form`);
        }
      }
      flush();
      if (!exited) {
        worker.end();
        const { code } = await worker.exit;
        expect(code === 0, `${scenario.scenario}: exit ${code} after end of input`);
      }
      expect(worker.queued() === 0, `${scenario.scenario}: the worker wrote more than the scenario expects`);
      report.scenarios.push({ scenario: scenario.scenario, receives: compared, ...(stoppedAt === undefined ? {} : { stoppedAtAdvance: true }) });
    }

    // 2. Every Fabric-to-worker frame the worker must refuse: one protocol_error, then exit 2.
    const base = readFixture("scenarios/create_exec_destroy.json").provider_state;
    const baseConfig = writeConfig("base", base);
    for (const file of readdirSync(join(fixtures, "frames")).sort()) {
      const fixture = readFixture(`frames/${file}`);
      if (fixture.direction !== "fabric_to_worker" || fixture.expect.outcome !== "reject") continue;
      const worker = spawnWorker(["--profile", "fixture", "--config", baseConfig]);
      if (fixture.phase === "session") {
        worker.send(hello);
        expect((await worker.next()).type === "hello_ack", `${fixture.case}: no hello_ack`);
      }
      worker.sendBytes(Buffer.from(fixture.hex, "hex"));
      worker.end();
      const refused = await worker.next();
      expect(refused.type === "protocol_error" && refused.code === fixture.expect.code, `${fixture.case}: got ${JSON.stringify(comparable(refused))}`);
      const { code } = await worker.exit;
      expect(code === 2, `${fixture.case}: exit ${code}, want 2`);
      report.frames.push({ case: fixture.case, code: refused.code });
    }

    // 3. Signals. SIGTERM with an exec in flight drains 5 s, answers the exec pending, exits 0.
    const seed = {
      native_id: "fx-key-create-1",
      project: "proj-1",
      owner_job: "01K8W3A00000000000000000J1",
      operation: "01K8W3A00000000000000000P1",
      status: "ready"
    };
    const longConfig = writeConfig("long-exec", {
      ...base,
      sandboxes: [seed],
      script: [{ action: "sandbox.exec", native_id: "fx-key-create-1", behavior: "run_until_cancelled" }]
    });
    {
      const worker = spawnWorker(["--profile", "fixture", "--config", longConfig]);
      worker.send(hello);
      await worker.next();
      worker.send(readFixture("cases/request_exec_valid.json").message);
      const progress = await worker.next();
      expect(progress.type === "progress" && progress.state === "running", `SIGTERM: no progress before the signal: ${JSON.stringify(progress)}`);
      worker.child.kill("SIGTERM");
      const answer = await worker.next();
      expect(
        answer.type === "error" && answer.error.code === "pending" && answer.error.reason === "shutting_down" && answer.error.effect === "pending",
        `SIGTERM: the exec in flight was not answered pending/shutting_down: ${JSON.stringify(comparable(answer))}`
      );
      const { code, signal } = await worker.exit;
      expect(code === 0 && signal === null, `SIGTERM: exit ${code} ${signal}, want 0`);
      report.signals.sigterm = "exec in flight answered pending/shutting_down, exit 0";
    }
    {
      const worker = spawnWorker(["--profile", "fixture", "--config", baseConfig]);
      worker.send(hello);
      await worker.next();
      worker.child.kill("SIGINT");
      const { code, signal } = await worker.exit;
      expect(code === 0 && signal === null, `SIGINT: exit ${code} ${signal}, want 0`);
      expect(worker.queued() === 0, "SIGINT: an idle worker wrote a frame");
      report.signals.sigint = "idle worker exits 0 with no frame";
    }

    // 4. Diagnostics stay clean and bounded on every run.
    let largest = 0;
    for (const worker of stderrs) {
      const text = worker.stderr();
      largest = Math.max(largest, Buffer.byteLength(text));
      expect(!/ExperimentalWarning|single[- ]executable/i.test(text), `a runtime warning reached stderr: ${text.slice(0, 300)}`);
    }
    expect(largest <= stderrBudget, `stderr of ${largest} bytes exceeds the negotiated ${stderrBudget}`);
    report.stderr = { workers: stderrs.length, largestBytes: largest, budgetBytes: stderrBudget };
    report.outcome = "passed";
  } finally {
    for (const worker of stderrs) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
    rmSync(scratch, { recursive: true, force: true });
  }
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, text);
  process.stdout.write(text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`bridge-artifact-smoke: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
