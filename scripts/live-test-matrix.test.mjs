import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createLiveTestMatrix } from "./live-test-matrix.mjs";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "live-test-matrix.mjs");

test("live test matrix reports ready read-only providers without leaking secret values", () => {
  const report = createLiveTestMatrix({
    provider: "vercel",
    env: {
      CAPSULE_LIVE_TESTS: "1",
      VERCEL_TOKEN: "secret-vercel-token",
      CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_secret"
    }
  });

  assert.deepEqual(report.providers, [
    {
      provider: "vercel",
      status: "ready",
      wouldRun: true,
      liveTestEnabled: true,
      costRisk: "read-only",
      costAcknowledged: true,
      resourceLimit: undefined,
      configuredEnv: ["CAPSULE_LIVE_TESTS", "VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"],
      missingEnv: [],
      missingCostEnv: [],
      missingResourceLimitEnv: [],
      requiredEnv: ["CAPSULE_LIVE_TESTS", "VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"],
      optionalEnv: ["VERCEL_TEAM_ID", "VERCEL_TEAM_SLUG", "VERCEL_PROJECT_ID"],
      testPath: "packages/vercel/src/vercel.live.test.ts",
      command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/vercel/src/vercel.live.test.ts",
      notes: ["Reads an existing Vercel deployment status; no resource is created."]
    }
  ]);
  assert.equal(JSON.stringify(report).includes("secret-vercel-token"), false);
  assert.equal(JSON.stringify(report).includes("dpl_secret"), false);
});

test("live test matrix blocks CI runs without explicit opt-in", () => {
  const blocked = createLiveTestMatrix({
    provider: "vercel",
    env: {
      CI: "true",
      CAPSULE_LIVE_TESTS: "1",
      VERCEL_TOKEN: "secret-vercel-token",
      CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_secret"
    }
  });

  assert.equal(blocked.providers[0]?.status, "blocked");
  assert.equal(blocked.providers[0]?.wouldRun, false);
  assert.deepEqual(blocked.providers[0]?.missingCiOptInEnv, ["CAPSULE_LIVE_TEST_CI_OPT_IN"]);
  assert.equal(blocked.providers[0]?.ciOptInLabel, "capsule:live-tests");

  const ready = createLiveTestMatrix({
    provider: "vercel",
    env: {
      CI: "true",
      CAPSULE_LIVE_TEST_CI_OPT_IN: "1",
      CAPSULE_LIVE_TESTS: "1",
      VERCEL_TOKEN: "secret-vercel-token",
      CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_secret"
    }
  });

  assert.equal(ready.providers[0]?.status, "ready");
  assert.equal(ready.providers[0]?.wouldRun, true);
  assert.deepEqual(ready.providers[0]?.missingCiOptInEnv, []);
  assert.equal(JSON.stringify(ready).includes("secret-vercel-token"), false);
});

test("live test matrix blocks untrusted fork CI runs even with opt-in", () => {
  const report = createLiveTestMatrix({
    provider: "vercel",
    env: {
      CI: "true",
      CAPSULE_LIVE_TEST_UNTRUSTED_FORK: "1",
      CAPSULE_LIVE_TEST_CI_OPT_IN: "1",
      CAPSULE_LIVE_TESTS: "1",
      VERCEL_TOKEN: "secret-vercel-token",
      CAPSULE_VERCEL_DEPLOYMENT_ID: "dpl_secret"
    }
  });

  assert.equal(report.providers[0]?.status, "blocked");
  assert.equal(report.providers[0]?.wouldRun, false);
  assert.equal(report.providers[0]?.ciUntrustedFork, true);
  assert.deepEqual(report.providers[0]?.missingCiOptInEnv, []);
  assert.equal(JSON.stringify(report).includes("secret-vercel-token"), false);
});

test("live test matrix blocks billable providers without cost acknowledgement", () => {
  const report = createLiveTestMatrix({
    provider: "fly",
    env: {
      CAPSULE_LIVE_TESTS: "1",
      FLY_API_TOKEN: "secret-fly-token",
      FLY_APP_NAME: "capsule-app",
      CAPSULE_FLY_IMAGE: "registry.example/app:latest"
    }
  });

  assert.equal(report.providers[0]?.status, "blocked");
  assert.equal(report.providers[0]?.wouldRun, false);
  assert.deepEqual(report.providers[0]?.missingEnv, []);
  assert.deepEqual(report.providers[0]?.missingCostEnv, ["CAPSULE_LIVE_TEST_COST_ACK"]);
  assert.deepEqual(report.providers[0]?.missingResourceLimitEnv, ["CAPSULE_LIVE_TEST_MAX_RESOURCES"]);
  assert.equal(JSON.stringify(report).includes("secret-fly-token"), false);
});

test("live test matrix blocks billable providers when max resource count is too low", () => {
  const report = createLiveTestMatrix({
    provider: "fly",
    env: {
      CAPSULE_LIVE_TESTS: "1",
      FLY_API_TOKEN: "secret-fly-token",
      FLY_APP_NAME: "capsule-app",
      CAPSULE_FLY_IMAGE: "registry.example/app:latest",
      CAPSULE_LIVE_TEST_COST_ACK: "1",
      CAPSULE_LIVE_TEST_MAX_RESOURCES: "0"
    }
  });

  assert.equal(report.providers[0]?.status, "blocked");
  assert.equal(report.providers[0]?.wouldRun, false);
  assert.deepEqual(report.providers[0]?.missingCostEnv, []);
  assert.deepEqual(report.providers[0]?.missingResourceLimitEnv, ["CAPSULE_LIVE_TEST_MAX_RESOURCES"]);
  assert.deepEqual(report.providers[0]?.resourceLimit, {
    env: "CAPSULE_LIVE_TEST_MAX_RESOURCES",
    required: 1,
    configured: 0,
    satisfied: false
  });
});

test("live test matrix reports quarantined flaky providers with revalidation metadata", () => {
  const quarantine = {
    reason: "provider control plane intermittently returns 503",
    lastObservedFailure: "2026-05-30T10:00:00Z",
    owner: "runtime-team",
    revalidationCommand: "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY=1 CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts"
  };
  const report = createLiveTestMatrix({
    provider: "fly",
    plans: [
      {
        provider: "fly",
        testPath: "packages/fly/src/fly.live.test.ts",
        requiredEnv: ["CAPSULE_LIVE_TESTS", "FLY_API_TOKEN", "FLY_APP_NAME"],
        optionalEnv: [],
        costRisk: "billable",
        costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
        command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts",
        quarantine,
        notes: []
      }
    ],
    env: {
      CAPSULE_LIVE_TESTS: "1",
      FLY_API_TOKEN: "secret-fly-token",
      FLY_APP_NAME: "capsule-app",
      CAPSULE_LIVE_TEST_COST_ACK: "1",
      CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
    }
  });

  assert.equal(report.providers[0]?.status, "quarantined");
  assert.equal(report.providers[0]?.wouldRun, false);
  assert.equal(report.providers[0]?.quarantineRevalidationEnv, "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY");
  assert.deepEqual(report.providers[0]?.quarantine, quarantine);
  assert.equal(report.summary.quarantined, 1);
  assert.equal(JSON.stringify(report).includes("secret-fly-token"), false);
});

test("live test matrix lets explicitly revalidated flaky providers become ready", () => {
  const report = createLiveTestMatrix({
    provider: "fly",
    plans: [
      {
        provider: "fly",
        testPath: "packages/fly/src/fly.live.test.ts",
        requiredEnv: ["CAPSULE_LIVE_TESTS", "FLY_API_TOKEN", "FLY_APP_NAME"],
        optionalEnv: [],
        costRisk: "billable",
        costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
        command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts",
        quarantine: {
          reason: "provider control plane intermittently returns 503",
          lastObservedFailure: "2026-05-30T10:00:00Z",
          owner: "runtime-team",
          revalidationCommand: "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY=1 CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts"
        },
        notes: []
      }
    ],
    env: {
      CAPSULE_LIVE_TEST_REVALIDATE_FLAKY: "1",
      CAPSULE_LIVE_TESTS: "1",
      FLY_API_TOKEN: "secret-fly-token",
      FLY_APP_NAME: "capsule-app",
      CAPSULE_LIVE_TEST_COST_ACK: "1",
      CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
    }
  });

  assert.equal(report.providers[0]?.status, "ready");
  assert.equal(report.providers[0]?.wouldRun, true);
  assert.equal(report.providers[0]?.quarantineRevalidationEnv, "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY");
});

test("live test matrix dry-run command emits JSON and exits without credentials", () => {
  const stdout = execFileSync(process.execPath, [scriptPath, "--dry-run", "--provider", "neon"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" }
  });
  const report = JSON.parse(stdout);

  assert.equal(report.dryRun, true);
  assert.equal(report.providers[0]?.provider, "neon");
  assert.equal(report.providers[0]?.status, "blocked");
  assert.deepEqual(report.providers[0]?.missingEnv, ["CAPSULE_LIVE_TESTS", "NEON_API_KEY", "NEON_PROJECT_ID"]);
});
