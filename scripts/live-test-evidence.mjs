#!/usr/bin/env node
// Decides whether a selected live-test run produced live evidence. Vitest exits 0 when every
// gated live test is skipped (missing credentials, cost acknowledgement, CI opt-in), so a green
// vitest step alone cannot tell "the provider was exercised" from "nothing ran". This script reads
// the Vitest JSON report and fails unless the selected suite ran, at least one live test executed
// and passed, and none failed.
//
// Usage:
//   node scripts/live-test-evidence.mjs --print-test-path --provider <provider>
//   node scripts/live-test-evidence.mjs --provider <provider> --report <vitest-json-report>
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { liveTestMatrixPlans } from "./live-test-matrix.mjs";

export function selectedLiveTestPath(provider, plans = liveTestMatrixPlans) {
  const plan = plans.find((entry) => entry.provider === provider);
  if (!plan) {
    throw new Error(`Unknown live-test provider "${provider}". Providers: ${plans.map((entry) => entry.provider).join(", ")}`);
  }
  return plan.testPath;
}

function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function normalizedPath(name, root) {
  const realRoot = realPath(root);
  const absolute = realPath(isAbsolute(name) ? name : resolve(realRoot, name));
  return relative(realRoot, absolute).split("\\").join("/");
}

/**
 * Classifies a Vitest JSON report for one selected live suite.
 * `evidence` is "executed" only when the selected file ran, at least one test passed and none failed.
 */
export function classifyLiveTestReport(report, { testPath, root = process.cwd() }) {
  const files = Array.isArray(report?.testResults) ? report.testResults : undefined;
  if (!files) {
    return { ok: false, evidence: "none", testPath, passed: 0, failed: 0, skipped: 0, reason: "the Vitest JSON report has no testResults" };
  }

  const ranPaths = files.map((file) => normalizedPath(String(file?.name ?? ""), root));
  const unexpected = ranPaths.filter((path) => path !== testPath);
  const selected = files.filter((_, index) => ranPaths[index] === testPath);
  const assertions = selected.flatMap((file) => (Array.isArray(file?.assertionResults) ? file.assertionResults : []));
  const count = (status) => assertions.filter((assertion) => assertion?.status === status).length;
  const passed = count("passed");
  const failed = count("failed") + selected.filter((file) => file?.status === "failed" && !(file.assertionResults?.length > 0)).length;
  const skipped = assertions.length - passed - count("failed");
  const skipReasons = assertions
    .filter((assertion) => assertion?.status !== "passed" && assertion?.status !== "failed")
    .map((assertion) => String(assertion?.title ?? ""))
    .filter(Boolean);
  const base = { testPath, passed, failed, skipped, ...(skipReasons.length > 0 ? { skippedTests: skipReasons } : {}) };

  if (unexpected.length > 0) {
    return { ok: false, evidence: "none", ...base, reason: `the run included files outside the selected suite: ${unexpected.join(", ")}` };
  }
  if (selected.length === 0) {
    return { ok: false, evidence: "none", ...base, reason: `the selected suite ${testPath} did not run` };
  }
  if (failed > 0) {
    return { ok: false, evidence: "failed", ...base, reason: `${failed} live test${failed === 1 ? "" : "s"} failed` };
  }
  if (passed === 0) {
    return {
      ok: false,
      evidence: "none",
      ...base,
      reason: "zero live tests executed; every selected test was skipped, so this run is not live evidence"
    };
  }
  return { ok: true, evidence: "executed", ...base };
}

function parseArgs(argv) {
  const options = { provider: undefined, report: undefined, printTestPath: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider" || arg === "--report") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--print-test-path") {
      options.printTestPath = true;
    } else {
      throw new Error(`Unknown argument "${arg}". Use --provider <provider> (--print-test-path | --report <file>).`);
    }
  }
  if (!options.provider) throw new Error("--provider is required.");
  if (!options.printTestPath && !options.report) throw new Error("--report is required unless --print-test-path is set.");
  return options;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parseArgs(argv);
  const testPath = selectedLiveTestPath(options.provider);
  if (options.printTestPath) {
    console.log(testPath);
    return 0;
  }
  if (!existsSync(options.report)) {
    console.log(
      JSON.stringify({ ok: false, evidence: "none", provider: options.provider, testPath, reason: `missing Vitest JSON report ${options.report}` }, null, 2)
    );
    return 1;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(options.report, "utf8"));
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          evidence: "none",
          provider: options.provider,
          testPath,
          reason: `unreadable Vitest JSON report: ${error instanceof Error ? error.message : String(error)}`
        },
        null,
        2
      )
    );
    return 1;
  }
  const result = { provider: options.provider, ...classifyLiveTestReport(report, { testPath, root }) };
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
