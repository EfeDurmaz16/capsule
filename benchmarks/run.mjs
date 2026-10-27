#!/usr/bin/env node
// Deterministic synthetic benchmark harness for the Capsule M1 performance workstream.
//
// All workloads are MOCK/SYNTHETIC: injected fake provider clients, a local fake `docker` executable
// and generated files. No provider is contacted and no credential is read. Results describe this
// harness on this host only; they are not cloud latency claims.
//
// Usage:
//   pnpm build
//   node benchmarks/run.mjs --label <name> [--reps N] [--only <workload-id>[,<id>]] [--large]
//
// Writes raw per-repetition JSON to benchmarks/raw/<label>/<workload>/<case>.json, a machine-readable
// summary to benchmarks/raw/<label>/summary.json and a plain-text table to benchmarks/results/<label>.txt.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { percentile } from "./lib/measure.mjs";

const benchRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(benchRoot, "..");
const { values: args } = parseArgs({
  options: {
    label: { type: "string" },
    reps: { type: "string" },
    only: { type: "string" },
    large: { type: "boolean", default: false },
    "case-timeout-ms": { type: "string", default: "180000" }
  }
});
if (!args.label || !/^[A-Za-z0-9._-]+$/.test(args.label)) {
  console.error("Usage: node benchmarks/run.mjs --label <name> [--reps N] [--only id,id] [--large]");
  process.exit(2);
}

const git = (...gitArgs) => spawnSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
const workloadDir = join(benchRoot, "workloads");
const workloadFiles = readdirSync(workloadDir)
  .filter((file) => file.endsWith(".mjs"))
  .sort();
const only = args.only ? new Set(args.only.split(",")) : undefined;
const repsOverride = args.reps ? Number(args.reps) : undefined;
const caseTimeoutMs = Number(args["case-timeout-ms"]);

const meta = {
  label: args.label,
  harness: "capsule synthetic benchmark harness v1",
  dataKind: "mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls",
  commit: git("rev-parse", "HEAD"),
  // Tree hash of packages/: identical values mean identical measured source even across harness-only commits.
  packagesTree: git("rev-parse", "HEAD:packages"),
  dirty: git("status", "--porcelain", "--untracked-files=no", "--", "packages") !== "",
  date: new Date().toISOString(),
  host: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    totalMemBytes: os.totalmem()
  },
  runtime: { node: process.version, v8: process.versions.v8, execArgv: ["--expose-gc"] },
  options: { reps: repsOverride ?? "workload default", only: args.only ?? null, large: args.large },
  notes: "Each repetition runs in a fresh Node process, sequentially; workloads never run concurrently with each other."
};

const rawRoot = join(benchRoot, "raw", args.label);
rmSync(rawRoot, { recursive: true, force: true });
mkdirSync(rawRoot, { recursive: true });
const scratch = mkdtempSync(join(os.tmpdir(), "capsule-bench-"));
const summary = { meta, workloads: [] };
const table = [];

function aggregate(reps) {
  // Numeric leaves are summarized (median, p95, min, max); non-numeric leaves keep the first value and
  // flag whether every repetition agreed, so behavioral observations stay visible next to timings.
  const leaves = new Map();
  const visit = (value, path) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    if (!leaves.has(path)) leaves.set(path, []);
    leaves.get(path).push(value);
  };
  reps.forEach((rep) => visit(rep, ""));
  const out = {};
  for (const [path, values] of leaves) {
    if (values.every((value) => typeof value === "number")) {
      const sorted = [...values].sort((left, right) => left - right);
      out[path] = { median: percentile(sorted, 50), p95: percentile(sorted, 95), min: sorted[0], max: sorted.at(-1), n: sorted.length };
    } else {
      const first = JSON.stringify(values[0]);
      out[path] = { value: values[0], consistent: values.every((value) => JSON.stringify(value) === first), n: values.length };
    }
  }
  return out;
}

for (const file of workloadFiles) {
  const { workload } = await import(pathToFileURL(join(workloadDir, file)).href);
  if (only && !only.has(workload.id)) continue;
  const workloadSummary = { id: workload.id, perfIds: workload.perfIds, manifestIds: workload.manifestIds, description: workload.description, cases: [] };
  mkdirSync(join(rawRoot, workload.id), { recursive: true });
  for (const benchCase of workload.cases) {
    if (benchCase.large && !args.large) continue;
    const reps = repsOverride ?? benchCase.reps ?? workload.reps ?? 5;
    const runs = [];
    for (let rep = 0; rep < reps; rep += 1) {
      const outFile = join(scratch, `${workload.id}-${benchCase.name}-${rep}.json`);
      const started = performance.now();
      const child = spawnSync(process.execPath, ["--expose-gc", join(benchRoot, "lib", "child.mjs"), join(workloadDir, file), benchCase.name, outFile, "{}"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: caseTimeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CAPSULE_BENCH_SCRATCH: scratch }
      });
      const wallMs = performance.now() - started;
      let record;
      try {
        record = JSON.parse(readFileSync(outFile, "utf8"));
      } catch {
        record = {
          ok: false,
          error: { name: "HarnessError", message: `child produced no result (status=${child.status}, signal=${child.signal})` },
          stderr: child.stderr?.slice(-2000)
        };
      }
      runs.push({ rep, childWallMs: wallMs, ...record });
      process.stderr.write(`${workload.id}/${benchCase.name} rep ${rep + 1}/${reps}: ${record.ok ? "ok" : `error ${record.error?.message}`}\n`);
    }
    const raw = {
      meta,
      workload: { id: workload.id, perfIds: workload.perfIds, manifestIds: workload.manifestIds },
      case: benchCase.name,
      description: benchCase.description,
      params: benchCase.params ?? {},
      runs
    };
    writeFileSync(join(rawRoot, workload.id, `${benchCase.name}.json`), `${JSON.stringify(raw, null, 2)}\n`);
    const okRuns = runs.filter((run) => run.ok);
    const caseSummary = {
      name: benchCase.name,
      description: benchCase.description,
      params: benchCase.params ?? {},
      reps,
      okReps: okRuns.length,
      errors: runs.filter((run) => !run.ok).map((run) => run.error),
      metrics: aggregate(okRuns.map((run) => ({ ...run.metrics, process: { maxRssBytes: run.process.maxRssBytes }, childWallMs: run.childWallMs })))
    };
    workloadSummary.cases.push(caseSummary);
    for (const key of benchCase.headline ?? []) {
      const metric = caseSummary.metrics[key];
      const shown =
        metric === undefined
          ? "n/a"
          : "median" in metric
            ? `median=${round(metric.median)} p95=${round(metric.p95)}`
            : `${JSON.stringify(metric.value)}${metric.consistent ? "" : " (varies)"}`;
      table.push(`${workload.id.padEnd(34)} ${benchCase.name.padEnd(30)} ${key.padEnd(34)} ${shown}`);
    }
    if (caseSummary.okReps < reps)
      table.push(`${workload.id.padEnd(34)} ${benchCase.name.padEnd(30)} ${"errors".padEnd(34)} ${reps - caseSummary.okReps}/${reps}`);
  }
  summary.workloads.push(workloadSummary);
}

function round(value) {
  if (value === null || value === undefined) return "n/a";
  return Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 1000) / 1000;
}

writeFileSync(join(rawRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
mkdirSync(join(benchRoot, "results"), { recursive: true });
const header = [
  `# Capsule synthetic benchmark: ${meta.label}`,
  `# ${meta.dataKind}`,
  `# commit=${meta.commit} packagesTree=${meta.packagesTree} dirtyPackages=${meta.dirty} date=${meta.date}`,
  `# host=${meta.host.platform} ${meta.host.release} ${meta.host.arch} cpus=${meta.host.cpus} (${meta.host.cpuModel}) mem=${Math.round(meta.host.totalMemBytes / 2 ** 30)}GiB node=${meta.runtime.node}`,
  `# raw: benchmarks/raw/${meta.label}/ (one JSON per case, every repetition kept)`,
  ""
];
writeFileSync(join(benchRoot, "results", `${meta.label}.txt`), `${[...header, ...table].join("\n")}\n`);
rmSync(scratch, { recursive: true, force: true });
console.log([...header, ...table].join("\n"));
