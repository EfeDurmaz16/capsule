// M3 bridge: capsule-bridge-worker spawn latency and request round trips on the fixture
// profile. LOCAL: spawns the built worker (packages/bridge-worker/dist/bin.js) and talks to it over
// its pipes with the independent client in scripts/bridge-worker-client.mjs. The fixture provider is
// in memory, so the numbers are worker plus framing plus Capsule facade cost, not provider latency.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { percentile } from "../lib/measure.mjs";
import { packageDir } from "../lib/packages.mjs";
import { hello, request, startWorker } from "../../scripts/bridge-worker-client.mjs";

const probe = fileURLToPath(new URL("../lib/exit-probe.mjs", import.meta.url));
const config = {
  binding: { account: "acct-a", project: "proj-1" },
  policy: { images: ["fixture/ok"] },
  approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }]
};

function stats(values) {
  return { p50: percentile(values, 50), p95: percentile(values, 95), min: Math.min(...values), max: Math.max(...values), n: values.length };
}

function withWorker(fn) {
  return async (params) => {
    const dir = mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "bridge-bench-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(config));
    const spawnOne = (index) => {
      const probeOut = join(dir, `probe-${index}.json`);
      const worker = startWorker({
        command: process.execPath,
        args: ["--import", probe, join(packageDir("bridge-worker"), "dist", "bin.js"), "--profile", "fixture", "--config", configPath],
        cwd: dir,
        env: { PATH: process.env.PATH ?? "", CAPSULE_BENCH_PROBE_OUT: probeOut }
      });
      return { worker, probeOut };
    };
    try {
      return await fn(params, spawnOne);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function spawnToHelloAck(params, spawnOne) {
  const latency = [];
  const rss = [];
  for (let index = 0; index < params.samples; index += 1) {
    const { worker, probeOut } = spawnOne(index);
    worker.send(hello("fixture"));
    const ack = await worker.next();
    if (ack.type !== "hello_ack") throw new Error(`expected hello_ack, got ${ack.type}`);
    latency.push(ack.receivedAtMs);
    worker.end();
    const { code } = await worker.exit;
    if (code !== 0) throw new Error(`worker exited ${code}`);
    rss.push(JSON.parse(readFileSync(probeOut, "utf8")).maxRssBytes);
  }
  return { spawnToHelloAckMs: stats(latency), workerMaxRssBytes: stats(rss), samples: params.samples };
}

async function roundTrips(params, spawnOne) {
  const { worker, probeOut } = spawnOne(0);
  worker.send(hello("fixture"));
  await worker.next();
  let n = 0;
  const timed = async (message) => {
    const started = performance.now();
    worker.send(message);
    const answer = await worker.next();
    return { answer, ms: performance.now() - started };
  };
  const created = await timed(request(++n, "sandbox.create", { params: { image: "fixture/ok", env: {}, secret_names: [], labels: {} } }));
  const target = created.answer.resource;
  const exec = [];
  let execOk = 0;
  for (let index = 0; index < params.execs; index += 1) {
    const { answer, ms } = await timed(
      request(++n, "sandbox.exec", {
        target,
        params: { argv: ["echo", String(index)], stdin: null, cwd: null, timeout_ms: 1000, max_output_bytes: 64, secret_names: [] }
      })
    );
    exec.push(ms);
    if (answer.type === "result" && answer.output.exit_code === 0) execOk += 1;
  }
  const create = [];
  const destroy = [];
  let lifecycleOk = 0;
  for (let index = 0; index < params.lifecycles; index += 1) {
    const made = await timed(request(++n, "sandbox.create", { params: { image: "fixture/ok", env: {}, secret_names: [], labels: {} } }));
    create.push(made.ms);
    const gone = await timed(request(++n, "sandbox.destroy", { target: made.answer.resource, params: {}, approval: { ref: "apr-destroy" } }));
    destroy.push(gone.ms);
    if (made.answer.type === "result" && gone.answer.type === "result") lifecycleOk += 1;
  }
  const refused = [];
  for (let index = 0; index < params.refusals; index += 1) {
    const { answer, ms } = await timed(request(++n, "sandbox.create", { params: { image: "fixture/forbidden", env: {}, secret_names: [], labels: {} } }));
    refused.push(ms);
    if (!(answer.type === "error" && answer.error.effect === "none")) throw new Error("a refusal had an effect");
  }
  worker.end();
  const { code } = await worker.exit;
  return {
    execRoundTripMs: stats(exec),
    createRoundTripMs: stats(create),
    destroyRoundTripMs: stats(destroy),
    refusalRoundTripMs: stats(refused),
    execOk,
    lifecycleOk,
    exitCode: code,
    workerMaxRssBytes: JSON.parse(readFileSync(probeOut, "utf8")).maxRssBytes
  };
}

export const workload = {
  id: "m3-bridge-worker",
  perfIds: [],
  manifestIds: ["M3-BRIDGE"],
  description: "Bridge worker on the fixture profile: spawn to hello_ack and sequential request round trips over real pipes.",
  reps: 3,
  cases: [
    {
      name: "spawn-to-hello-ack",
      description: "Fresh worker process per sample: time from spawn to a decoded hello_ack, and the worker's peak RSS.",
      params: { samples: 20 },
      headline: ["spawnToHelloAckMs.p50", "spawnToHelloAckMs.p95", "workerMaxRssBytes.p50"],
      run: ({ params }) => withWorker(spawnToHelloAck)(params)
    },
    {
      name: "request-round-trip",
      description: "One worker: 500 sequential execs, 100 create and destroy pairs, 100 policy refusals; each timed from write to decoded answer.",
      params: { execs: 500, lifecycles: 100, refusals: 100 },
      headline: [
        "execRoundTripMs.p50",
        "execRoundTripMs.p95",
        "createRoundTripMs.p50",
        "destroyRoundTripMs.p50",
        "refusalRoundTripMs.p50",
        "workerMaxRssBytes"
      ],
      run: ({ params }) => withWorker(roundTrips)(params)
    }
  ]
};
