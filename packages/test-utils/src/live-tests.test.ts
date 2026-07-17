import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  liveProviderCredentials,
  liveProviderRegistry,
  liveResourceMetadata,
  liveTest,
  liveTestGate,
  providerLiveTestGate,
  type LiveTestApi
} from "./index.js";

function withGitHubEvent(payload: unknown, assertion: (eventPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "capsule-live-event-"));
  const eventPath = join(directory, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload), "utf8");
  try {
    assertion(eventPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("live test gates", () => {
  test("skips live tests unless CAPSULE_LIVE_TESTS is enabled", () => {
    expect(liveTestGate({ provider: "vercel", credentials: liveProviderCredentials.vercel, env: {} })).toEqual({
      enabled: false,
      skipReason: "vercel live tests require CAPSULE_LIVE_TESTS=1."
    });
  });

  test("reports missing provider credentials after live tests are enabled", () => {
    expect(providerLiveTestGate("cloudflare", { env: { CAPSULE_LIVE_TESTS: "1", CLOUDFLARE_API_TOKEN: "token" } })).toEqual({
      enabled: false,
      skipReason: "cloudflare live tests require credential env var: CLOUDFLARE_ACCOUNT_ID."
    });
  });

  test("reports all missing provider credentials", () => {
    expect(providerLiveTestGate("cloudflare", { env: { CAPSULE_LIVE_TESTS: "1" } })).toEqual({
      enabled: false,
      skipReason: "cloudflare live tests require credential env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID."
    });
  });

  test("billable provider live tests require cost acknowledgement and max resource count", () => {
    expect(providerLiveTestGate("neon", { env: { CAPSULE_LIVE_TESTS: "1", NEON_API_KEY: "key", NEON_PROJECT_ID: "project" } })).toEqual({
      enabled: false,
      skipReason: "neon live tests require CAPSULE_LIVE_TEST_COST_ACK=1 for billable provider work."
    });
    expect(
      providerLiveTestGate("neon", {
        env: { CAPSULE_LIVE_TESTS: "1", NEON_API_KEY: "key", NEON_PROJECT_ID: "project", CAPSULE_LIVE_TEST_COST_ACK: "1" }
      })
    ).toEqual({
      enabled: false,
      skipReason: "neon live tests require CAPSULE_LIVE_TEST_MAX_RESOURCES to be a positive integer >= 1."
    });
    expect(
      providerLiveTestGate("neon", {
        env: {
          CAPSULE_LIVE_TESTS: "1",
          NEON_API_KEY: "key",
          NEON_PROJECT_ID: "project",
          CAPSULE_LIVE_TEST_COST_ACK: "1",
          CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
        }
      })
    ).toEqual({ enabled: true });
  });

  test("read-only provider live tests do not require cost guards", () => {
    expect(providerLiveTestGate("vercel", { env: { CAPSULE_LIVE_TESTS: "1", VERCEL_TOKEN: "token" } })).toEqual({ enabled: true });
  });

  test("requires explicit CI opt-in before enabling live tests", () => {
    expect(
      providerLiveTestGate("vercel", {
        env: {
          CI: "true",
          CAPSULE_LIVE_TESTS: "1",
          VERCEL_TOKEN: "token"
        }
      })
    ).toEqual({
      enabled: false,
      skipReason: "vercel live tests require CAPSULE_LIVE_TEST_CI_OPT_IN=1 or GitHub label capsule:live-tests in CI."
    });

    expect(
      providerLiveTestGate("vercel", {
        env: {
          CI: "true",
          CAPSULE_LIVE_TEST_CI_OPT_IN: "1",
          CAPSULE_LIVE_TESTS: "1",
          VERCEL_TOKEN: "token"
        }
      })
    ).toEqual({ enabled: true });
  });

  test("allows trusted labeled CI pull requests and blocks untrusted forks", () => {
    withGitHubEvent(
      {
        repository: { full_name: "capsule-org/capsule" },
        pull_request: {
          head: { repo: { full_name: "capsule-org/capsule", fork: false } },
          base: { repo: { full_name: "capsule-org/capsule" } },
          labels: [{ name: "capsule:live-tests" }]
        }
      },
      (eventPath) => {
        expect(
          providerLiveTestGate("vercel", {
            env: {
              CI: "true",
              GITHUB_ACTIONS: "true",
              GITHUB_EVENT_NAME: "pull_request",
              GITHUB_EVENT_PATH: eventPath,
              GITHUB_REPOSITORY: "capsule-org/capsule",
              CAPSULE_LIVE_TESTS: "1",
              VERCEL_TOKEN: "token"
            }
          })
        ).toEqual({ enabled: true });
      }
    );

    withGitHubEvent(
      {
        repository: { full_name: "capsule-org/capsule" },
        pull_request: {
          head: { repo: { full_name: "outside/capsule", fork: true } },
          base: { repo: { full_name: "capsule-org/capsule" } },
          labels: [{ name: "capsule:live-tests" }]
        }
      },
      (eventPath) => {
        expect(
          providerLiveTestGate("vercel", {
            env: {
              CI: "true",
              GITHUB_ACTIONS: "true",
              GITHUB_EVENT_NAME: "pull_request",
              GITHUB_EVENT_PATH: eventPath,
              GITHUB_REPOSITORY: "capsule-org/capsule",
              CAPSULE_LIVE_TEST_CI_OPT_IN: "1",
              CAPSULE_LIVE_TESTS: "1",
              VERCEL_TOKEN: "token"
            }
          })
        ).toEqual({
          enabled: false,
          skipReason: "vercel live tests are disabled for untrusted fork pull requests."
        });
      }
    );
  });

  test("billable live tests honor custom planned resource counts", () => {
    expect(
      liveTestGate({
        provider: "fly",
        credentials: liveProviderCredentials.fly,
        maxResourceCount: 2,
        env: {
          CAPSULE_LIVE_TESTS: "1",
          FLY_API_TOKEN: "token",
          FLY_APP_NAME: "app",
          CAPSULE_LIVE_TEST_COST_ACK: "1",
          CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
        }
      })
    ).toEqual({
      enabled: false,
      skipReason: "fly live tests require CAPSULE_LIVE_TEST_MAX_RESOURCES to be a positive integer >= 2."
    });
  });

  test("gates deployment providers behind provider-specific resource env", () => {
    expect(providerLiveTestGate("cloud-run", { env: { CAPSULE_LIVE_TESTS: "1", GOOGLE_CLOUD_PROJECT: "project" } })).toEqual({
      enabled: false,
      skipReason: "cloud-run live tests require credential env vars: GOOGLE_CLOUD_RUN_LOCATION, GOOGLE_OAUTH_ACCESS_TOKEN."
    });
    expect(
      providerLiveTestGate("aws", {
        env: {
          CAPSULE_LIVE_TESTS: "1",
          AWS_REGION: "us-east-1",
          CAPSULE_LAMBDA_FUNCTION_NAME: "fn",
          CAPSULE_LIVE_TEST_COST_ACK: "1",
          CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
        }
      })
    ).toEqual({
      enabled: true
    });
  });

  test("registers every real adapter live-test gate and excludes mocks", () => {
    expect(liveProviderRegistry.map((entry) => entry.packageName).sort()).toEqual([
      "@capsule-sdk/azure",
      "@capsule-sdk/cloud-run",
      "@capsule-sdk/cloudflare",
      "@capsule-sdk/daytona",
      "@capsule-sdk/docker",
      "@capsule-sdk/e2b",
      "@capsule-sdk/ec2",
      "@capsule-sdk/ecs",
      "@capsule-sdk/fly",
      "@capsule-sdk/kubernetes",
      "@capsule-sdk/lambda",
      "@capsule-sdk/modal",
      "@capsule-sdk/neon",
      "@capsule-sdk/vercel"
    ]);
    const packageNames = liveProviderRegistry.map((entry) => String(entry.packageName));
    expect(packageNames.includes("@capsule-sdk/mock")).toBe(false);
  });

  test("registry entries have deterministic skip reasons", () => {
    for (const entry of liveProviderRegistry) {
      expect(liveTestGate({ provider: entry.provider, credentials: entry.credentials, env: {} }).skipReason).toBe(
        `${entry.provider} live tests require CAPSULE_LIVE_TESTS=1.`
      );
      if (entry.credentials.length > 0) {
        expect(liveTestGate({ provider: entry.provider, credentials: entry.credentials, env: { CAPSULE_LIVE_TESTS: "1" } }).skipReason).toContain(
          entry.credentials.join(", ")
        );
      }
    }
  });

  test("skipped live tests include explicit gate reasons in the test name", () => {
    const names: string[] = [];
    const api: LiveTestApi = {
      skipIf: (condition) => (name) => {
        expect(condition).toBe(true);
        names.push(name);
      }
    };

    liveTest(api, "reads provider state", { provider: "neon", credentials: liveProviderCredentials.neon, env: {} }, () => undefined);

    expect(names).toEqual(["reads provider state (skipped: neon live tests require CAPSULE_LIVE_TESTS=1.)"]);
  });

  test("quarantines flaky live tests with owner and revalidation metadata", () => {
    const quarantine = {
      reason: "provider control plane intermittently returns 503",
      lastObservedFailure: "2026-05-30T10:00:00Z",
      owner: "runtime-team",
      revalidationCommand: "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY=1 CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts"
    };

    expect(
      liveTestGate({
        provider: "fly",
        credentials: liveProviderCredentials.fly,
        quarantine,
        env: {
          CAPSULE_LIVE_TESTS: "1",
          FLY_API_TOKEN: "token",
          FLY_APP_NAME: "app",
          CAPSULE_LIVE_TEST_COST_ACK: "1",
          CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
        }
      })
    ).toEqual({
      enabled: false,
      quarantine,
      skipReason:
        "fly live test is quarantined: provider control plane intermittently returns 503. Owner: runtime-team. Last observed failure: 2026-05-30T10:00:00Z. Revalidate with: CAPSULE_LIVE_TEST_REVALIDATE_FLAKY=1 CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/fly/src/fly.live.test.ts"
    });

    expect(
      liveTestGate({
        provider: "fly",
        credentials: liveProviderCredentials.fly,
        quarantine,
        env: {
          CAPSULE_LIVE_TEST_REVALIDATE_FLAKY: "1",
          CAPSULE_LIVE_TESTS: "1",
          FLY_API_TOKEN: "token",
          FLY_APP_NAME: "app",
          CAPSULE_LIVE_TEST_COST_ACK: "1",
          CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
        }
      })
    ).toEqual({ enabled: true, quarantine });
  });

  test("gates Daytona live tests on Daytona credentials", () => {
    expect(providerLiveTestGate("daytona", { env: { CAPSULE_LIVE_TESTS: "1" } })).toEqual({
      enabled: false,
      skipReason: "daytona live tests require credential env var: DAYTONA_API_KEY."
    });
  });

  test("gates Modal live tests behind Modal token configuration", () => {
    expect(providerLiveTestGate("modal", { env: { CAPSULE_LIVE_TESTS: "1", MODAL_TOKEN_ID: "id" } })).toEqual({
      enabled: false,
      skipReason: "modal live tests require credential env var: MODAL_TOKEN_SECRET."
    });
    expect(
      providerLiveTestGate("modal", {
        env: {
          CAPSULE_LIVE_TESTS: "1",
          MODAL_TOKEN_ID: "id",
          MODAL_TOKEN_SECRET: "secret",
          CAPSULE_LIVE_TEST_COST_ACK: "1",
          CAPSULE_LIVE_TEST_MAX_RESOURCES: "1"
        }
      })
    ).toEqual({
      enabled: true
    });
  });

  test("builds deterministic live resource names and portable TTL labels", () => {
    const metadata = liveResourceMetadata({
      provider: "azure-container-apps",
      resource: "service",
      env: {
        CAPSULE_LIVE_TEST_OWNER: "Efe Baran",
        GITHUB_REPOSITORY: "capsule-labs/capsule",
        GITHUB_RUN_ID: "12345",
        GITHUB_RUN_ATTEMPT: "2"
      },
      now: new Date("2026-05-30T12:00:00.000Z"),
      ttlMs: 1_800_000,
      maxNameLength: 32
    });

    expect(metadata.name).toBe("capsule-live-azure-cont-58f792aa");
    expect(metadata.ttlMs).toBe(1_800_000);
    expect(metadata.labels).toEqual({
      capsule_live_test: "true",
      capsule_managed_by: "capsule",
      capsule_owner: "efe-baran",
      capsule_provider: "azure-container-apps",
      capsule_repo: "capsule",
      capsule_resource: "service",
      capsule_run_id: "12345-2",
      capsule_ttl_ms: "1800000",
      capsule_expires_at: "1780144200"
    });
  });

  test("uses explicit run and TTL env overrides for live resource metadata", () => {
    const metadata = liveResourceMetadata({
      provider: "neon",
      resource: "branch",
      env: {
        CAPSULE_LIVE_TEST_OWNER: "Capsule Ops",
        CAPSULE_LIVE_TEST_REPO: "capsule",
        CAPSULE_LIVE_TEST_RUN_ID: "manual-run-7",
        CAPSULE_LIVE_TEST_TTL_MS: "900000"
      },
      now: new Date("2026-05-30T12:00:00.000Z")
    });

    expect(metadata.name).toBe("capsule-live-neon-branch-manual-run-7");
    expect(metadata.ttlMs).toBe(900_000);
    expect(metadata.labels.capsule_owner).toBe("capsule-ops");
    expect(metadata.labels.capsule_run_id).toBe("manual-run-7");
    expect(metadata.labels.capsule_expires_at).toBe("1780143300");
  });

  test("rejects invalid live resource TTL overrides", () => {
    expect(() =>
      liveResourceMetadata({
        provider: "e2b",
        resource: "sandbox",
        env: { CAPSULE_LIVE_TEST_TTL_MS: "0" }
      })
    ).toThrow("CAPSULE_LIVE_TEST_TTL_MS must be a positive integer.");
  });
});
