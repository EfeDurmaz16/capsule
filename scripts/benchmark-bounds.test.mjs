import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBenchmarkBounds } from "../benchmarks/check-bounds.mjs";

const root = join(import.meta.dirname, "..");
const readSummary = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const baseline = readSummary("benchmarks/raw/baseline-7d3a28a/summary.json");
const after = readSummary("benchmarks/after/raw/after-85506c1/summary.json");

test("CI-07: the archived M1 after run meets every deterministic bound", () => {
  const report = checkBenchmarkBounds(after);
  assert.equal(
    report.failed,
    0,
    JSON.stringify(
      report.results.filter((entry) => entry.status === "fail"),
      null,
      2
    )
  );
  assert.equal(report.notRun, 0);
  assert.equal(report.ok, true);
});

test("CI-07: the archived clean-main baseline fails the bounds it was measured to break", () => {
  const report = checkBenchmarkBounds(baseline);
  const failed = new Set(report.results.filter((entry) => entry.status === "fail").map((entry) => `${entry.case}:${entry.metric}`));
  assert.equal(report.ok, false);
  for (const expected of [
    "long-lived-best-effort:final.receiptsStillReachable",
    "parallel-required-failing-a:outcomes.bRejectedWithAError",
    "large-file-tiny-limit:bytesRead",
    "ec2-owned-client:uniqueSdkClients",
    "endless-limit-10:bodyCancelled",
    "40-pods-3-containers-all:leakedSecrets",
    "stdout-100MiB:stdoutLengthReturned"
  ]) {
    assert.ok(failed.has(expected), `baseline should fail ${expected}`);
  }
});

test("CI-07: a workload that did not run is not-run, never a pass, and fails when required", () => {
  const onlyAws = { meta: after.meta, workloads: after.workloads.filter((entry) => entry.id === "perf-03-aws-client-reuse") };
  const report = checkBenchmarkBounds(onlyAws);
  assert.ok(report.notRun > 0);
  assert.equal(report.ok, true);
  assert.equal(checkBenchmarkBounds(onlyAws, { require: ["perf-05-kubernetes-logs"] }).ok, false);
  assert.equal(checkBenchmarkBounds({ workloads: [] }).ok, false, "an empty summary checks nothing and is not a pass");
});

test("CI-07: wall time and RSS are never gated", async () => {
  const { benchmarkBounds } = await import("../benchmarks/check-bounds.mjs");
  for (const bound of benchmarkBounds) {
    assert.doesNotMatch(bound.metric, /elapsed|Ms$|rss|Rss|latency|opsPerSecond/i, `${bound.metric} is host-dependent`);
  }
});
