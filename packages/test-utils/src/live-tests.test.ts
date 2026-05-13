import { describe, expect, test } from "vitest";
import { liveProviderCredentials, liveTestGate, providerLiveTestGate } from "./index.js";

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
