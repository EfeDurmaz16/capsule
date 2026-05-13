import { describe, expect, test } from "vitest";
import { buildRuntimeConfig, summarizeReceipt } from "./index.js";
import type { CapsuleReceipt } from "@capsule/core";

describe("preview environment example runtime config", () => {
  test("uses demo-only mocks when live verification is not enabled", () => {
    const config = buildRuntimeConfig({});

    expect(config.mode).toBe("demo-only");
    expect(config.liveProviders).toEqual([]);
    expect(config.plan.databases).toHaveLength(1);
    expect(config.plan.edges).toHaveLength(1);
    expect(config.plan.services).toBeUndefined();
    expect(config.plan.jobs).toHaveLength(1);
  });

  test("does not allow mock fallback to satisfy live verification", () => {
    expect(() => buildRuntimeConfig({ CAPSULE_LIVE_TESTS: "1", NEON_API_KEY: "neon" })).toThrow(
      /Mock fallback is demo-only and cannot satisfy live verification/
    );
  });

  test("composes only credential-gated live adapters", () => {
    const config = buildRuntimeConfig({
      CAPSULE_LIVE_TESTS: "1",
      NEON_API_KEY: "neon",
      NEON_PROJECT_ID: "project",
      VERCEL_TOKEN: "vercel"
    });

    expect(config.mode).toBe("live");
    expect(config.liveProviders).toEqual(["neon", "vercel"]);
    expect(config.plan.databases).toHaveLength(1);
    expect(config.plan.edges).toHaveLength(1);
    expect(config.plan.services).toBeUndefined();
    expect(config.plan.jobs).toBeUndefined();
  });

  test("adds optional Cloud Run service only when explicit credentials are present", () => {
    const config = buildRuntimeConfig({
      CAPSULE_LIVE_TESTS: "1",
      NEON_API_KEY: "neon",
      NEON_PROJECT_ID: "project",
      VERCEL_TOKEN: "vercel",
      GOOGLE_CLOUD_PROJECT: "gcp-project",
      GOOGLE_CLOUD_RUN_LOCATION: "us-central1",
      GOOGLE_OAUTH_ACCESS_TOKEN: "google-token"
    });

    expect(config.liveProviders).toEqual(["neon", "vercel", "cloud-run"]);
    expect(config.plan.services).toHaveLength(1);
  });

  test("receipt summaries do not print metadata or provider options", () => {
    const receipt: CapsuleReceipt = {
      id: "receipt-1",
      type: "database.branch.delete",
      provider: "neon",
      adapter: "neon",
      capabilityPath: "database.branchDelete",
      supportLevel: "native",
      providerOptions: { token: "[REDACTED]" },
      startedAt: "2026-05-13T00:00:00.000Z",
      finishedAt: "2026-05-13T00:00:01.000Z",
      durationMs: 1000,
      policy: { decision: "allowed", applied: {} },
      resource: { id: "branch-1", status: "deleted" },
      metadata: { connectionString: "postgres://secret@example.test/db" }
    };

    expect(summarizeReceipt(receipt)).toEqual({
      id: "receipt-1",
      type: "database.branch.delete",
      provider: "neon",
      adapter: "neon",
      capabilityPath: "database.branchDelete",
      supportLevel: "native",
      resource: { id: "branch-1", status: "deleted" }
    });
  });
});
