import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { PreviewCreationError } from "@capsule-sdk/preview";
import { buildRuntimeConfig, createAndCleanUpPreview, summarizeReceipt } from "./index.js";
import type { CapsuleReceipt } from "@capsule-sdk/core";

describe("preview environment example runtime config", () => {
  test("uses demo-only mocks when live verification is not enabled", () => {
    const config = buildRuntimeConfig({});

    expect(config.mode).toBe("demo-only");
    expect(config.liveProviders).toEqual([]);
    expect(config.plan.requireRealProviders).toBe(true);
    expect(config.plan.allowMockProviders).toBe(true);
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
    expect(config.plan.requireRealProviders).toBe(true);
    expect(config.plan.allowMockProviders).toBeUndefined();
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

describe("preview environment example cleanup (DOC-01)", () => {
  test("cleans up every created resource it can and reports the unsupported edge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "capsule-preview-example-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const { plan } = buildRuntimeConfig({ CAPSULE_EXAMPLE_RECEIPTS_PATH: join(dir, "receipts.jsonl") });
      const cleanup = await createAndCleanUpPreview(plan);
      const byKind = Object.fromEntries(cleanup.dispositions.map((entry) => [entry.resource.kind, entry.disposition]));
      expect(byKind.database).toBe("cleaned");
      expect(byKind.edge).toBe("unsupported");
      expect(cleanup.failed).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a part-way creation failure cleans up the resources created so far, then rethrows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "capsule-preview-example-"));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const { plan } = buildRuntimeConfig({ CAPSULE_EXAMPLE_RECEIPTS_PATH: join(dir, "receipts.jsonl") });
      const deleteBranch = vi.spyOn(plan.databases![0]!.capsule.database.branch, "delete");
      vi.spyOn(plan.edges![0]!.capsule.edge, "deploy").mockRejectedValue(new Error("edge provider unavailable"));

      const error = await createAndCleanUpPreview(plan).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PreviewCreationError);
      expect((error as PreviewCreationError).resources.map((resource) => resource.kind)).toEqual(["database"]);
      expect(deleteBranch).toHaveBeenCalledTimes(1);
      expect(lines.join("\n")).toMatch(/"disposition": "cleaned"/);
    } finally {
      vi.restoreAllMocks();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
