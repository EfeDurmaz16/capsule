// PERF-14 (SB-07, IO-01): Docker sandbox artifact collection for 1, 10 and 100 requested paths.
// LOCAL FAKE: a fake `docker` executable on PATH (benchmarks/fixtures/fake-docker) serves `docker cp`
// from a generated directory that stands in for the container filesystem; no daemon is used. Every
// requested path is a file named out.txt in its own directory, so the SB-07 layout (d<i>/out.txt) is on
// the measured path.
//
// The fake's process spawn is cheaper than the real docker CLI round trip, so the "latency" cases add a
// modelled 25 ms per `docker cp` call (`sleep`). That figure is a model, taken from a local real Docker
// Engine measurement of about 28 ms median per single-file `docker cp` on the benchmark host; it is not a
// claim about any other Docker host.
//
// The nested cases request /work and then each /work/d<i>/out.txt inside it, so every copy takes the
// sequential branch that checks each destination directory for planted symbolic links; they measure that
// check against the same number of docker cp spawns.
//
// The opt-in real-docker cases run the same collection against a real local Docker Engine with a local
// image named by CAPSULE_BENCH_REAL_DOCKER_IMAGE (never pulled; the container has --network none and is
// removed afterwards). They are skipped unless that variable is set.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeError, maxRssBytes, memory, settleGc, sha256 } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

const fakeDockerDir = fileURLToPath(new URL("../fixtures/fake-docker/", import.meta.url));
const fileBytes = 4096;

function contentFor(index) {
  return `artifact ${index}\n`.padEnd(fileBytes, String(index % 10));
}

function measured(result, error, params, elapsedMs, rssBefore, before, spawns) {
  const after = memory();
  const artifacts = result?.artifacts ?? [];
  const layout = artifacts.map((artifact) => `${artifact.path}\t${artifact.sha256}\t${artifact.sizeBytes ?? ""}`).sort();
  // One path keeps the plain basename; several keep their location below the deepest shared directory.
  // Nested requests share the root, so files keep work/d<i>/out.txt and each is collected once.
  const prefix = (index) => (params.nested ? `work/d${index}/` : params.paths === 1 ? "" : `d${index}/`);
  const expected = Array.from({ length: params.paths }, (_, index) => `${prefix(index)}out.txt\t${sha256(contentFor(index))}\t${fileBytes}`).sort();
  return {
    paths: params.paths,
    requestedPaths: requestedPaths(params).length,
    outcome: error ? "rejected" : "resolved",
    error: describeError(error),
    elapsedMs,
    dockerCpSpawns: spawns,
    artifactsCollected: artifacts.length,
    bytesCollected: artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
    // SB-07 layout, selection and hash parity with what one docker cp per path produces.
    layoutMatchesExpected: JSON.stringify(layout) === JSON.stringify(expected),
    layoutDigest: sha256(layout.join("\n")),
    peakRssGrowthBytes: maxRssBytes() - rssBefore,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed
  };
}

function requestedPaths(params) {
  const files = Array.from({ length: params.paths }, (_, index) => `/work/d${index}/out.txt`);
  return params.nested ? ["/work", ...files] : files;
}

async function runFake(params) {
  const scratch = mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "docker-artifacts-"));
  try {
    const root = join(scratch, "container");
    for (let index = 0; index < params.paths; index += 1) {
      mkdirSync(join(root, "work", `d${index}`), { recursive: true });
      writeFileSync(join(root, "work", `d${index}`, "out.txt"), contentFor(index));
    }
    const log = join(scratch, "docker-calls.log");
    process.env.PATH = `${fakeDockerDir}:${process.env.PATH}`;
    process.env.CAPSULE_BENCH_DOCKER_ROOT = root;
    process.env.CAPSULE_BENCH_DOCKER_LOG = log;
    process.env.CAPSULE_BENCH_DOCKER_STDOUT_BYTES = "0";
    if (params.latencySeconds) process.env.CAPSULE_BENCH_DOCKER_CP_LATENCY_S = String(params.latencySeconds);
    const { Capsule } = await loadPackage("core");
    const { docker } = await loadPackage("docker");
    const box = await new Capsule({ adapter: docker() }).sandbox.create({ image: "bench-fake-image" });
    const artifactPaths = requestedPaths(params);
    writeFileSync(log, "");
    await settleGc();
    const before = memory();
    const rssBefore = maxRssBytes();
    const started = performance.now();
    let result;
    let error;
    try {
      result = await box.exec({ command: ["true"], artifactPaths });
    } catch (caught) {
      error = caught;
    }
    const elapsedMs = performance.now() - started;
    const spawns = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line === "cp").length;
    const metrics = measured(result, error, params, elapsedMs, rssBefore, before, spawns);
    await box.destroy().catch(() => undefined);
    return metrics;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function runReal(params) {
  const image = process.env.CAPSULE_BENCH_REAL_DOCKER_IMAGE;
  const inspected = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" });
  if (inspected.status !== 0) throw new Error(`Local image ${image} not found; this workload never pulls images.`);
  const { Capsule } = await loadPackage("core");
  const { docker } = await loadPackage("docker");
  const capsule = new Capsule({ adapter: docker(), policy: { network: { mode: "none" } } });
  const box = await capsule.sandbox.create({ image, name: `capsule-bench-perf14-${process.pid}` });
  try {
    // Same files as the fake cases, written inside the container.
    const script = [
      `i=0; while [ $i -lt ${params.paths} ]; do`,
      `mkdir -p /work/d$i; s="artifact $i"; { printf '%s\\n' "$s"; yes $((i % 10)) | tr -d '\\n' | head -c $((${fileBytes} - \${#s} - 1)); } > /work/d$i/out.txt;`,
      "i=$((i + 1)); done"
    ].join(" ");
    const prepared = await box.exec({ command: ["sh", "-c", script] });
    if (prepared.exitCode !== 0) throw new Error(`fixture setup failed: ${prepared.stderr}`);
    const artifactPaths = Array.from({ length: params.paths }, (_, index) => `/work/d${index}/out.txt`);
    await settleGc();
    const before = memory();
    const rssBefore = maxRssBytes();
    const started = performance.now();
    let result;
    let error;
    try {
      result = await box.exec({ command: ["true"], artifactPaths });
    } catch (caught) {
      error = caught;
    }
    const elapsedMs = performance.now() - started;
    // One docker cp per path is the adapter's documented transfer; the real CLI is not instrumented.
    return measured(result, error, params, elapsedMs, rssBefore, before, null);
  } finally {
    await box.destroy().catch(() => undefined);
  }
}

const headline = ["dockerCpSpawns", "bytesCollected", "layoutMatchesExpected", "elapsedMs"];

export const workload = {
  id: "perf-14-docker-artifacts",
  perfIds: ["PERF-14"],
  manifestIds: ["SB-07", "IO-01"],
  description: "Docker sandbox artifact collection for 1/10/100 paths: docker cp spawns, bytes, time and SB-07 layout parity.",
  reps: 5,
  cases: [
    ...[1, 10, 100].map((paths) => ({
      name: `paths-${paths}`,
      params: { paths },
      description: `${paths} artifact paths, fake docker cp without added latency (process spawn cost only).`,
      headline,
      run: ({ params }) => runFake(params)
    })),
    ...[1, 10, 100].map((paths) => ({
      name: `paths-${paths}-latency-25ms`,
      params: { paths, latencySeconds: 0.025 },
      description: `${paths} artifact paths, fake docker cp with a modelled 25 ms CLI round trip per call.`,
      headline,
      run: ({ params }) => runFake(params)
    })),
    ...[10, 100].map((paths) => ({
      name: `nested-${paths}`,
      params: { paths, nested: true },
      description: `/work plus the ${paths} files inside it, fake docker cp without added latency: sequential copies with the destination check.`,
      headline,
      run: ({ params }) => runFake(params)
    })),
    ...[10, 100].map((paths) => ({
      name: `real-docker-paths-${paths}`,
      requiresEnv: "CAPSULE_BENCH_REAL_DOCKER_IMAGE",
      reps: 3,
      params: { paths },
      description: `${paths} artifact paths against a real local Docker Engine (opt-in, local image only).`,
      headline: ["bytesCollected", "layoutMatchesExpected", "elapsedMs"],
      run: ({ params }) => runReal(params)
    }))
  ]
};
