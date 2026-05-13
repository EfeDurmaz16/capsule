import { describe, expect, test } from "vitest";
import { liveProviderCredentials, liveProviderRegistry, liveTest, liveTestGate, providerLiveTestGate, type LiveTestApi } from "./index.js";

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

  test("enables provider live tests when the flag and credentials are present", () => {
    expect(providerLiveTestGate("neon", { env: { CAPSULE_LIVE_TESTS: "1", NEON_API_KEY: "key", NEON_PROJECT_ID: "project" } })).toEqual({ enabled: true });
  });

  test("gates deployment providers behind provider-specific resource env", () => {
    expect(providerLiveTestGate("cloud-run", { env: { CAPSULE_LIVE_TESTS: "1", GOOGLE_CLOUD_PROJECT: "project" } })).toEqual({
      enabled: false,
      skipReason: "cloud-run live tests require credential env vars: GOOGLE_CLOUD_RUN_LOCATION, GOOGLE_OAUTH_ACCESS_TOKEN."
    });
    expect(providerLiveTestGate("aws", { env: { CAPSULE_LIVE_TESTS: "1", AWS_REGION: "us-east-1", CAPSULE_LAMBDA_FUNCTION_NAME: "fn" } })).toEqual({
      enabled: true
    });
  });

  test("registers every real adapter live-test gate and excludes mocks", () => {
    expect(liveProviderRegistry.map((entry) => entry.packageName).sort()).toEqual([
      "@capsule/adapter-azure-container-apps",
      "@capsule/adapter-cloud-run",
      "@capsule/adapter-cloudflare",
      "@capsule/adapter-daytona",
      "@capsule/adapter-docker",
      "@capsule/adapter-e2b",
      "@capsule/adapter-ec2",
      "@capsule/adapter-ecs",
      "@capsule/adapter-fly",
      "@capsule/adapter-kubernetes",
      "@capsule/adapter-lambda",
      "@capsule/adapter-modal",
      "@capsule/adapter-neon",
      "@capsule/adapter-vercel"
    ]);
    const packageNames = liveProviderRegistry.map((entry) => String(entry.packageName));
    expect(packageNames.includes("@capsule/adapter-mock")).toBe(false);
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
    expect(providerLiveTestGate("modal", { env: { CAPSULE_LIVE_TESTS: "1", MODAL_TOKEN_ID: "id", MODAL_TOKEN_SECRET: "secret" } })).toEqual({
      enabled: true
    });
  });
});
