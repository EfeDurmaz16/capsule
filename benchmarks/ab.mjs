#!/usr/bin/env node
// Interleaved A/B benchmark: the same synthetic workloads run against an anchor build (A) and this
// checkout's build (B) in one session, alternating A, B, A, B, so host load drifts hit both sides alike.
//
// All workloads are MOCK/SYNTHETIC (see benchmarks/README.md). Nothing contacts a provider.
//
// Usage:
//   pnpm build                                   # build B (this checkout)
//   git archive <anchor> | tar -x -C <dir>       # then pnpm install --frozen-lockfile && pnpm build in <dir>
//   node benchmarks/ab.mjs --label <name> --anchor-packages <dir>/packages --anchor-commit <sha> [--pairs 15]
//        [--candidate-packages <dir>/packages --candidate-commit <sha>]
//        [--only <workload-id>[,<id>]] [--cases <workload>/<case>[,...]]
//
// Without --candidate-packages, B is this checkout's packages/ (do not rebuild while it runs). A built
// snapshot of a commit (git archive, install, build in a scratch directory) keeps B fixed instead.
//
// For each pair i and each case: one fresh child process on A, then one on B. Per metric it reports the
// median of the per-pair ratios B/A with a 95% bootstrap interval (10000 resamples of pairs, seeded), and
// the A and B medians. A ratio below 1 means B is lower (faster or smaller); for throughput metrics (ops
// per second) higher is better and the verdict flips.
//
// Writes benchmarks/ab/<label>/raw/<workload>/<case>.json (every run), benchmarks/ab/<label>/summary.json
// and benchmarks/ab/<label>/report.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { percentile, seededRandom } from "./lib/measure.mjs";

const benchRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(benchRoot, "..");
const { values: args } = parseArgs({
  options: {
    label: { type: "string" },
    "anchor-packages": { type: "string" },
    "anchor-commit": { type: "string" },
    "candidate-packages": { type: "string" },
    "candidate-commit": { type: "string" },
    pairs: { type: "string", default: "15" },
    only: { type: "string" },
    cases: { type: "string" },
    "case-timeout-ms": { type: "string", default: "180000" }
  }
});
if (!args.label || !/^[A-Za-z0-9._-]+$/.test(args.label) || !args["anchor-packages"] || !args["anchor-commit"]) {
  console.error("Usage: node benchmarks/ab.mjs --label <name> --anchor-packages <dir> --anchor-commit <sha> [--pairs N] [--only ids] [--cases w/c]");
  process.exit(2);
}
const anchorPackages = resolve(args["anchor-packages"]);
if (!existsSync(join(anchorPackages, "core", "dist", "index.js"))) {
  console.error(`No built anchor packages under ${anchorPackages}; run pnpm build there first.`);
  process.exit(2);
}
const candidatePackages = args["candidate-packages"] ? resolve(args["candidate-packages"]) : undefined;
if (candidatePackages && (!args["candidate-commit"] || !existsSync(join(candidatePackages, "core", "dist", "index.js")))) {
  console.error("--candidate-packages needs built packages and --candidate-commit <sha>.");
  process.exit(2);
}
const pairs = Number(args.pairs);
if (!Number.isInteger(pairs) || pairs < 2) throw new Error("--pairs must be an integer >= 2");
const caseTimeoutMs = Number(args["case-timeout-ms"]);
const only = args.only ? new Set(args.only.split(",")) : undefined;
const onlyCases = args.cases ? new Set(args.cases.split(",")) : undefined;

const git = (...gitArgs) => spawnSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
const meta = {
  label: args.label,
  harness: "capsule synthetic benchmark harness v1, interleaved A/B",
  dataKind: "mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls",
  order: "for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process",
  pairs,
  anchor: { commit: args["anchor-commit"], packagesTree: git("rev-parse", `${args["anchor-commit"]}:packages`) },
  candidate: candidatePackages
    ? {
        commit: git("rev-parse", args["candidate-commit"]),
        packagesTree: git("rev-parse", `${args["candidate-commit"]}:packages`),
        dirtyPackages: false,
        snapshot: true
      }
    : {
        commit: git("rev-parse", "HEAD"),
        packagesTree: git("rev-parse", "HEAD:packages"),
        dirtyPackages: git("status", "--porcelain", "--untracked-files=no", "--", "packages") !== "",
        snapshot: false
      },
  harnessCommit: git("rev-parse", "HEAD"),
  date: new Date().toISOString(),
  host: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemBytes: os.totalmem(),
    loadAverageAtStart: os.loadavg()
  },
  runtime: { node: process.version, v8: process.versions.v8 },
  statistic: "median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1)"
};

const workloadDir = join(benchRoot, "workloads");
const selected = [];
for (const file of readdirSync(workloadDir)
  .filter((name) => name.endsWith(".mjs"))
  .sort()) {
  const { workload } = await import(pathToFileURL(join(workloadDir, file)).href);
  if (only && !only.has(workload.id)) continue;
  for (const benchCase of workload.cases) {
    if (benchCase.large) continue;
    if (benchCase.requiresEnv && !process.env[benchCase.requiresEnv]) continue;
    if (onlyCases && !onlyCases.has(`${workload.id}/${benchCase.name}`)) continue;
    selected.push({ file, workload, benchCase });
  }
}

const outRoot = join(benchRoot, "ab", args.label);
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(join(outRoot, "raw"), { recursive: true });
const scratch = mkdtempSync(join(os.tmpdir(), "capsule-ab-"));

function runChild(entry, side, pair) {
  const outFile = join(scratch, `${entry.workload.id}-${entry.benchCase.name}-${side}-${pair}.json`);
  const env = { ...process.env, CAPSULE_BENCH_SCRATCH: scratch };
  if (side === "A") env.CAPSULE_BENCH_PACKAGES_ROOT = anchorPackages;
  else if (candidatePackages) env.CAPSULE_BENCH_PACKAGES_ROOT = candidatePackages;
  else delete env.CAPSULE_BENCH_PACKAGES_ROOT;
  const started = performance.now();
  const child = spawnSync(
    process.execPath,
    ["--expose-gc", join(benchRoot, "lib", "child.mjs"), join(workloadDir, entry.file), entry.benchCase.name, outFile, "{}"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: caseTimeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env
    }
  );
  const childWallMs = performance.now() - started;
  let record;
  try {
    record = JSON.parse(readFileSync(outFile, "utf8"));
  } catch {
    record = { ok: false, error: { name: "HarnessError", message: `child produced no result (status=${child.status}, signal=${child.signal})` } };
  }
  rmSync(outFile, { force: true });
  // Stack traces carry local checkout paths; the message and name are enough in the archived data.
  delete record.stack;
  return { side, pair, childWallMs, loadAverage1m: os.loadavg()[0], ...record };
}

const runs = new Map(selected.map((entry) => [entry, []]));
for (let pair = 0; pair < pairs; pair += 1) {
  for (const entry of selected) {
    const list = runs.get(entry);
    list.push(runChild(entry, "A", pair));
    list.push(runChild(entry, "B", pair));
  }
  process.stderr.write(`pair ${pair + 1}/${pairs} done (load ${os.loadavg()[0].toFixed(1)})\n`);
}

function numericLeaves(record) {
  const out = new Map();
  const visit = (value, path) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) out.set(path, value);
  };
  visit({ ...record.metrics, process: { maxRssBytes: record.process?.maxRssBytes }, childWallMs: record.childWallMs }, "");
  return out;
}

function otherLeaves(record) {
  const out = new Map();
  const visit = (value, path) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    if (typeof value !== "number") out.set(path, JSON.stringify(value));
  };
  visit(record.metrics ?? {}, "");
  return out;
}

const higherIsBetter = (metric) => /opsPerSecond|throughput/i.test(metric);
// Costs: time, memory, bytes read or emitted, process spawns, statement preparations, SDK clients and
// leaks. Every other numeric metric is a count of what the workload did (entries returned, requests in
// flight, ...), so a difference there is reported as "changed", never as better or worse.
const isCost = (metric) =>
  /(Ms|ms)($|\.)|Rss|rss|heap|Heap|bytesRead|bytesEmitted|Spawns|PrepareCalls|PrepareMs|readCalls|uniqueSdkClients|leakedSecrets|receiptsStillReachable|bRejectedWithAError/.test(
    metric
  );

function bootstrapMedianInterval(ratios, random) {
  const medians = [];
  for (let sample = 0; sample < 10000; sample += 1) {
    const draw = [];
    for (let index = 0; index < ratios.length; index += 1) draw.push(ratios[Math.floor(random() * ratios.length)]);
    medians.push(median(draw));
  }
  medians.sort((left, right) => left - right);
  return [medians[Math.floor(0.025 * medians.length)], medians[Math.min(medians.length - 1, Math.ceil(0.975 * medians.length) - 1)]];
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function verdict(metric, interval) {
  if (!interval) return "n/a";
  const [low, high] = interval;
  if (low === 1 && high === 1) return "equal";
  if (!isCost(metric) && !higherIsBetter(metric)) return low > 1 || high < 1 ? "changed" : "same";
  const better = higherIsBetter(metric) ? low > 1 : high < 1;
  const worse = higherIsBetter(metric) ? high < 1 : low > 1;
  return better ? "better" : worse ? "worse" : "no difference";
}

const summary = { meta: { ...meta, loadAverageAtEnd: os.loadavg() }, cases: [] };
const report = [
  `# Interleaved A/B: ${meta.label}`,
  "",
  `${meta.dataKind}. Order: ${meta.order}. Pairs: ${pairs}.`,
  "",
  `A (anchor) ${meta.anchor.commit} packages tree ${meta.anchor.packagesTree}; B (candidate) ${meta.candidate.commit} packages tree ${meta.candidate.packagesTree}${meta.candidate.dirtyPackages ? " (dirty)" : ""}.`,
  "",
  `Host ${meta.host.platform} ${meta.host.release} ${meta.host.arch}, ${meta.host.cpus} CPUs (${meta.host.cpuModel}), node ${meta.runtime.node}; load average at start ${meta.host.loadAverageAtStart.map((value) => value.toFixed(1)).join("/")}, at end ${summary.meta.loadAverageAtEnd.map((value) => value.toFixed(1)).join("/")}.`,
  "",
  `Statistic: ${meta.statistic}. Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".`,
  "",
  "| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |"
];
const random = seededRandom(1);
for (const entry of selected) {
  const list = runs.get(entry);
  mkdirSync(join(outRoot, "raw", entry.workload.id), { recursive: true });
  writeFileSync(
    join(outRoot, "raw", entry.workload.id, `${entry.benchCase.name}.json`),
    `${JSON.stringify({ meta, workload: entry.workload.id, case: entry.benchCase.name, params: entry.benchCase.params ?? {}, runs: list }, null, 2)}\n`
  );
  const a = list.filter((run) => run.side === "A");
  const b = list.filter((run) => run.side === "B");
  const caseSummary = {
    workload: entry.workload.id,
    case: entry.benchCase.name,
    okA: a.filter((run) => run.ok).length,
    okB: b.filter((run) => run.ok).length,
    errorsA: [...new Set(a.filter((run) => !run.ok).map((run) => run.error?.message))],
    errorsB: [...new Set(b.filter((run) => !run.ok).map((run) => run.error?.message))],
    metrics: {},
    observations: {}
  };
  const okPairs = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    const runA = a.find((run) => run.pair === pair);
    const runB = b.find((run) => run.pair === pair);
    if (runA?.ok && runB?.ok) okPairs.push([numericLeaves(runA), numericLeaves(runB)]);
  }
  const metricNames = new Set(okPairs.flatMap(([left, right]) => [...left.keys(), ...right.keys()]));
  for (const metric of [...metricNames].sort()) {
    const usable = okPairs.filter(([left, right]) => left.has(metric) && right.has(metric));
    if (usable.length < 2) continue;
    const valuesA = usable.map(([left]) => left.get(metric));
    const valuesB = usable.map(([, right]) => right.get(metric));
    const ratios = usable.map(([left, right]) => {
      const x = left.get(metric);
      const y = right.get(metric);
      return x === 0 ? (y === 0 ? 1 : Number.POSITIVE_INFINITY) : y / x;
    });
    const finite = ratios.every((ratio) => Number.isFinite(ratio));
    const interval = finite ? bootstrapMedianInterval(ratios, random) : undefined;
    caseSummary.metrics[metric] = {
      n: usable.length,
      medianA: median(valuesA),
      medianB: median(valuesB),
      p95A: percentile(valuesA, 95),
      p95B: percentile(valuesB, 95),
      medianRatio: finite ? median(ratios) : null,
      ci95: interval ?? null,
      verdict: verdict(metric, interval)
    };
  }
  // Behavioral observations (strings, booleans) from the first ok run of each side.
  const firstA = a.find((run) => run.ok);
  const firstB = b.find((run) => run.ok);
  if (firstA || firstB) {
    const left = firstA ? otherLeaves(firstA) : new Map();
    const right = firstB ? otherLeaves(firstB) : new Map();
    for (const key of new Set([...left.keys(), ...right.keys()])) caseSummary.observations[key] = { A: left.get(key) ?? null, B: right.get(key) ?? null };
  }
  summary.cases.push(caseSummary);
  const headline = new Set([...(entry.benchCase.headline ?? []), ...(entry.benchCase.abHeadline ?? []), "process.maxRssBytes", "childWallMs"]);
  for (const metric of headline) {
    const stats = caseSummary.metrics[metric];
    if (!stats) continue;
    report.push(
      `| ${entry.workload.id} | ${entry.benchCase.name} | ${metric} | ${fmt(stats.medianA)} | ${fmt(stats.medianB)} | ${stats.medianRatio === null ? "n/a" : stats.medianRatio.toFixed(3)} | ${stats.ci95 ? `${stats.ci95[0].toFixed(3)} to ${stats.ci95[1].toFixed(3)}` : "n/a"} | ${stats.verdict} |`
    );
  }
  if (caseSummary.okA < pairs || caseSummary.okB < pairs) {
    report.push(
      `| ${entry.workload.id} | ${entry.benchCase.name} | ok runs | ${caseSummary.okA}/${pairs} | ${caseSummary.okB}/${pairs} | | | ${[...caseSummary.errorsA, ...caseSummary.errorsB].join("; ").replaceAll("|", "/").slice(0, 160)} |`
    );
  }
}

function fmt(value) {
  if (value === null || value === undefined) return "n/a";
  return Math.abs(value) >= 100 ? String(Math.round(value)) : String(Math.round(value * 1000) / 1000);
}

writeFileSync(join(outRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outRoot, "report.md"), `${report.join("\n")}\n`);
rmSync(scratch, { recursive: true, force: true });
console.log(report.join("\n"));
