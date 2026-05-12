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
    expect(providerLiveTestGate("neon", { env: { CAPSULE_LIVE_TESTS: "1", NEON_API_KEY: "key" } })).toEqual({ enabled: true });
  });
});
