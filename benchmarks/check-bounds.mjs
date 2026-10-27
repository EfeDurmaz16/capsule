#!/usr/bin/env node
// Checks a benchmark summary (benchmarks/run.mjs output) against deterministic bounds: resource
// counts, byte caps, concurrency caps and behavioral observations that do not depend on host speed.
// Wall-time and RSS numbers are reported by the harness but never gated here, because they have
// not been calibrated across hosts. A workload that was not run is reported as "not-run", never as
// a pass.
//
// Usage: node benchmarks/check-bounds.mjs <summary.json> [--require <workload-id>[,<id>]]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MiB = 1024 * 1024;

/**
 * Each bound names one metric of one case. `stat` picks the worst repetition for numeric bounds
 * (`max` for upper bounds, `min` for lower bounds); observations must be consistent across reps.
 */
export const benchmarkBounds = [
  // PERF-01 / CORE-01 / CORE-02
  {
    workload: "perf-01-core-receipts",
    case: "long-lived-best-effort",
    metric: "final.receiptsStillReachable",
    max: 8,
    why: "completed receipts are not retained by a live sandbox"
  },
  {
    workload: "perf-01-core-receipts",
    case: "long-lived-required",
    metric: "final.receiptsStillReachable",
    max: 8,
    why: "completed receipts are not retained in required mode"
  },
  {
    workload: "perf-01-core-receipts",
    case: "parallel-required-delayed-a",
    metric: "bSettlesBeforeA",
    equals: true,
    why: "an operation awaits only its own receipt write"
  },
  {
    workload: "perf-01-core-receipts",
    case: "parallel-required-failing-a",
    metric: "outcomes.bRejectedWithAError",
    max: 0,
    why: "a sibling's write failure does not reject another operation"
  },
  // PERF-02 / IO-01
  { workload: "perf-02-artifact-collection", case: "large-file-tiny-limit", metric: "bytesRead", max: 0, why: "an over-budget file is not read" },
  {
    workload: "perf-02-artifact-collection",
    case: "large-file-within-budget",
    metric: "hashMatches",
    equals: true,
    why: "bounded reads keep the artifact hash"
  },
  // PERF-03 / AWS-05
  { workload: "perf-03-aws-client-reuse", case: "ec2-owned-client", metric: "uniqueSdkClients", max: 1, why: "one EC2 client per adapter" },
  { workload: "perf-03-aws-client-reuse", case: "ecs-owned-client", metric: "uniqueSdkClients", max: 1, why: "one ECS client per adapter" },
  { workload: "perf-03-aws-client-reuse", case: "lambda-owned-client", metric: "uniqueSdkClients", max: 1, why: "one Lambda client per adapter" },
  { workload: "perf-03-aws-client-reuse", case: "ec2-injected-client", metric: "uniqueSdkClients", max: 0, why: "an injected client is used, not replaced" },
  // PERF-04 / EDGE-02 / EDGE-03
  {
    workload: "perf-04-vercel-log-streams",
    case: "endless-limit-10",
    metric: "bodyCancelled",
    equals: true,
    why: "an endless log body is cancelled at the limit"
  },
  { workload: "perf-04-vercel-log-streams", case: "endless-limit-10", metric: "bytesEmitted", max: 1 * MiB, why: "an endless log body is not drained" },
  { workload: "perf-04-vercel-log-streams", case: "endless-limit-10", metric: "entriesWithinLimit", equals: true, why: "limit is honored" },
  { workload: "perf-04-vercel-log-streams", case: "finite-array", metric: "entriesWithinLimit", equals: true, why: "limit is honored" },
  { workload: "perf-04-vercel-log-streams", case: "ndjson-fragmented", metric: "entriesWithinLimit", equals: true, why: "limit is honored across fragments" },
  {
    workload: "perf-04-vercel-log-streams",
    case: "ndjson-malformed",
    metric: "entriesWithinLimit",
    equals: true,
    why: "limit is honored with malformed lines"
  },
  // PERF-05 / SVC-01 / SVC-09
  {
    workload: "perf-05-kubernetes-logs",
    case: "40-pods-3-containers-all",
    metric: "leakedSecrets",
    max: 0,
    why: "literal env values are redacted across pods"
  },
  {
    workload: "perf-05-kubernetes-logs",
    case: "40-pods-3-containers-all",
    metric: "maxOutstandingRequests",
    max: 4,
    why: "log reads stay under the concurrency cap"
  },
  {
    workload: "perf-05-kubernetes-logs",
    case: "40-pods-3-containers-all",
    metric: "globallyAscendingTimestamps",
    equals: true,
    why: "merged logs are globally ordered"
  },
  {
    workload: "perf-05-kubernetes-logs",
    case: "40-pods-3-containers-limit-20",
    metric: "matchesGlobalNewestInOrder",
    equals: true,
    why: "a limit keeps the globally newest entries"
  },
  // PERF-10
  {
    workload: "perf-10-docker-output",
    case: "stdout-100MiB",
    metric: "stdoutLengthReturned",
    max: 16 * MiB,
    why: "captured output is capped at the default 16 MiB budget"
  }
];

function caseMetric(summary, bound) {
  const workload = summary?.workloads?.find((entry) => entry.id === bound.workload);
  if (!workload) return { state: "not-run" };
  const found = workload.cases?.find((entry) => entry.name === bound.case);
  if (!found) return { state: "missing", detail: `case ${bound.case} not in summary` };
  const metric = found.metrics?.[bound.metric];
  if (!metric) return { state: "missing", detail: `metric ${bound.metric} not recorded${found.errors?.length ? ` (errors: ${found.errors.length})` : ""}` };
  return { state: "present", metric };
}

export function checkBenchmarkBounds(summary, { require = [] } = {}) {
  const results = benchmarkBounds.map((bound) => {
    const base = { workload: bound.workload, case: bound.case, metric: bound.metric, why: bound.why };
    const lookup = caseMetric(summary, bound);
    if (lookup.state === "not-run") {
      return { ...base, status: require.includes(bound.workload) ? "fail" : "not-run", detail: "workload not in summary" };
    }
    if (lookup.state === "missing") return { ...base, status: "fail", detail: lookup.detail };
    const { metric } = lookup;
    if ("equals" in bound) {
      const ok = metric.consistent !== false && metric.value === bound.equals;
      return { ...base, status: ok ? "pass" : "fail", expected: bound.equals, actual: metric.value, consistent: metric.consistent };
    }
    const actual = metric.max;
    const ok = typeof actual === "number" && actual <= bound.max;
    return { ...base, status: ok ? "pass" : "fail", expected: `<= ${bound.max}`, actual };
  });
  const count = (status) => results.filter((entry) => entry.status === status).length;
  return {
    ok: count("fail") === 0 && count("pass") > 0,
    gated: "deterministic counts, caps and observations only; wall time and RSS are not gated",
    label: summary?.meta?.label,
    commit: summary?.meta?.commit,
    passed: count("pass"),
    failed: count("fail"),
    notRun: count("not-run"),
    results
  };
}

export function main(argv = process.argv.slice(2)) {
  const path = argv.find((arg) => !arg.startsWith("--"));
  const requireIndex = argv.indexOf("--require");
  const require = requireIndex >= 0 ? (argv[requireIndex + 1] ?? "").split(",").filter(Boolean) : [];
  if (!path) throw new Error("Usage: node benchmarks/check-bounds.mjs <summary.json> [--require id,id]");
  const report = checkBenchmarkBounds(JSON.parse(readFileSync(path, "utf8")), { require });
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
