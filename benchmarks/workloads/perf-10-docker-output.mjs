// PERF-10 (CD-BOUNDS dependency): Docker exec output accumulation at 10/100(/1000) MiB.
// LOCAL FAKE: a fake `docker` executable on PATH (benchmarks/fixtures/fake-docker) emits synthetic
// output; no Docker daemon or container is used.
import { fileURLToPath } from "node:url";
import { MiB, describeError, maxRssBytes, memory, settleGc } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

const fakeDockerDir = fileURLToPath(new URL("../fixtures/fake-docker/", import.meta.url));

async function run(params) {
  process.env.PATH = `${fakeDockerDir}:${process.env.PATH}`;
  process.env.CAPSULE_BENCH_DOCKER_STDOUT_BYTES = String(params.stdoutBytes);
  const { Capsule } = await loadPackage("core");
  const { docker } = await loadPackage("docker");
  const capsule = new Capsule({ adapter: docker() });
  const box = await capsule.sandbox.create({ image: "bench-fake-image" });
  await settleGc();
  const before = memory();
  const rssBefore = maxRssBytes();
  const started = performance.now();
  let result;
  let error;
  try {
    result = await box.exec({ command: ["emit"] });
  } catch (caught) {
    error = caught;
  }
  const elapsedMs = performance.now() - started;
  const after = memory();
  const metrics = {
    stdoutBytesEmitted: params.stdoutBytes,
    outcome: error ? "rejected" : "resolved",
    error: describeError(error),
    elapsedMs,
    stdoutLengthReturned: result ? result.stdout.length : null,
    stderrEndsWithMarker: result ? result.stderr.trimEnd().endsWith("synthetic-stderr-marker") : null,
    logEntriesReturned: result ? result.logs.length : null,
    resultKeys: result ? Object.keys(result).sort() : null,
    peakRssBytes: maxRssBytes(),
    peakRssGrowthBytes: maxRssBytes() - rssBefore,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed
  };
  await box.destroy().catch(() => undefined);
  return metrics;
}

export const workload = {
  id: "perf-10-docker-output",
  perfIds: ["PERF-10"],
  manifestIds: ["CD-BOUNDS"],
  description: "Docker exec stdout capture size, truncation visibility and peak RSS with a local fake docker binary.",
  reps: 3,
  cases: [
    {
      name: "stdout-10MiB",
      params: { stdoutBytes: 10 * MiB },
      description: "10 MiB of 100-byte lines on stdout.",
      headline: ["outcome", "stdoutLengthReturned", "peakRssGrowthBytes", "elapsedMs"],
      run: ({ params }) => run(params)
    },
    {
      name: "stdout-100MiB",
      params: { stdoutBytes: 100 * MiB },
      description: "100 MiB of 100-byte lines on stdout.",
      headline: ["outcome", "stdoutLengthReturned", "peakRssGrowthBytes", "elapsedMs"],
      run: ({ params }) => run(params)
    },
    {
      name: "stdout-1000MiB",
      large: true,
      reps: 1,
      params: { stdoutBytes: 1000 * MiB },
      description: "1000 MiB on stdout. Opt-in with --large: unbounded capture can exhaust memory on small hosts.",
      headline: ["outcome", "stdoutLengthReturned", "peakRssGrowthBytes", "elapsedMs"],
      run: ({ params }) => run(params)
    }
  ]
};
