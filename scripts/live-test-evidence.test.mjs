import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLiveTestReport, selectedLiveTestPath } from "./live-test-evidence.mjs";
import { liveTestMatrixPlans } from "./live-test-matrix.mjs";

const root = join(import.meta.dirname, "..");
const vitestBin = join(root, "node_modules", ".bin", "vitest");
const scriptPath = join(root, "scripts", "live-test-evidence.mjs");

// Environment with every live gate input removed, so the real live suite skips and nothing reaches a provider.
function offlineEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("CAPSULE_") || name.startsWith("NEON_") || name === "CI" || name === "GITHUB_ACTIONS") delete env[name];
  }
  return env;
}

function runVitest(args, cwd, env = offlineEnv()) {
  return spawnSync(vitestBin, ["run", ...args], { cwd, env, encoding: "utf8" });
}

test("CI-03: a real Vitest run whose live suite was fully skipped exits 0 but is not live evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "capsule-live-evidence-"));
  try {
    const reportPath = join(dir, "report.json");
    const testPath = selectedLiveTestPath("neon");
    const vitest = runVitest([testPath, "--reporter=json", `--outputFile.json=${reportPath}`], root);
    assert.equal(vitest.status, 0, "vitest reports success when every live test is skipped");

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const result = classifyLiveTestReport(report, { testPath, root });
    assert.equal(result.ok, false);
    assert.equal(result.evidence, "none");
    assert.equal(result.passed, 0);
    assert.ok(result.skipped >= 1);
    assert.match(result.reason, /zero live tests executed/);

    const cli = spawnSync(process.execPath, [scriptPath, "--provider", "neon", "--report", reportPath], { cwd: root, encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.match(cli.stdout, /"evidence": "none"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CI-03: an executed, passing selected suite is evidence; a failing or foreign file is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "capsule-live-evidence-pass-"));
  try {
    const testPath = "packages/demo/src/demo.live.test.mjs";
    mkdirSync(join(dir, "packages", "demo", "src"), { recursive: true });
    writeFileSync(join(dir, testPath), 'it("runs", () => {});\nit.skip("gated", () => {});\n');
    const reportPath = join(dir, "report.json");
    const vitest = runVitest([testPath, "--globals", "--reporter=json", `--outputFile.json=${reportPath}`], dir);
    assert.equal(vitest.status, 0, vitest.stderr);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));

    const passed = classifyLiveTestReport(report, { testPath, root: dir });
    assert.deepEqual([passed.ok, passed.evidence, passed.passed, passed.failed, passed.skipped], [true, "executed", 1, 0, 1]);

    const otherSuite = classifyLiveTestReport(report, { testPath: "packages/other/src/other.live.test.ts", root: dir });
    assert.equal(otherSuite.ok, false);
    assert.match(otherSuite.reason, /outside the selected suite/);

    writeFileSync(join(dir, testPath), 'it("runs", () => { throw new Error("provider said no"); });\n');
    const failing = runVitest([testPath, "--globals", "--reporter=json", `--outputFile.json=${reportPath}`], dir);
    assert.notEqual(failing.status, 0);
    const failed = classifyLiveTestReport(JSON.parse(readFileSync(reportPath, "utf8")), { testPath, root: dir });
    assert.deepEqual([failed.ok, failed.evidence, failed.failed], [false, "failed", 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CI-03: missing or malformed reports and an unselected suite are never evidence", () => {
  assert.equal(classifyLiveTestReport({}, { testPath: "a.live.test.ts", root }).ok, false);
  assert.match(classifyLiveTestReport({ testResults: [] }, { testPath: "a.live.test.ts", root }).reason, /did not run/);

  const missing = spawnSync(process.execPath, [scriptPath, "--provider", "neon", "--report", join(tmpdir(), "capsule-no-such-report.json")], {
    encoding: "utf8"
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /missing Vitest JSON report/);
});

test("CI-03: the selected test path comes from the live-test plan for every provider", () => {
  for (const plan of liveTestMatrixPlans) {
    assert.equal(selectedLiveTestPath(plan.provider), plan.testPath);
  }
  assert.throws(() => selectedLiveTestPath("not-a-provider"), /Unknown live-test provider/);
});
