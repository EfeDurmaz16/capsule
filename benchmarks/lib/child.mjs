// Runs exactly one (workload, case, repetition) in a fresh process so peak RSS and heap readings
// belong to that case alone. Invoked by benchmarks/run.mjs with --expose-gc.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describeError, maxRssBytes, memory } from "./measure.mjs";

const [workloadFile, caseName, outFile, paramsJson] = process.argv.slice(2);
const { workload } = await import(pathToFileURL(workloadFile).href);
const benchCase = workload.cases.find((candidate) => candidate.name === caseName);
if (!benchCase) {
  throw new Error(`Unknown case ${caseName} in ${workload.id}`);
}
const params = { ...(benchCase.params ?? {}), ...JSON.parse(paramsJson || "{}") };
const startMemory = memory();
const started = performance.now();
let record;
try {
  const metrics = await benchCase.run({ params });
  record = { ok: true, metrics };
} catch (error) {
  record = { ok: false, error: describeError(error), stack: error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : undefined };
}
record.caseDurationMs = performance.now() - started;
record.process = { startMemory, endMemory: memory(), maxRssBytes: maxRssBytes() };
writeFileSync(outFile, JSON.stringify(record));
// Exit explicitly: a workload that measures a hang (for example a never-closing stream) must not keep
// the child alive after its watchdog recorded the outcome.
process.exit(0);
