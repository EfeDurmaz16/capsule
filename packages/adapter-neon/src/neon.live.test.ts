import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveTest, providerLiveTestGate } from "@capsule/test-utils";
import { neon } from "./index.js";

describe("neon live smoke", () => {
  liveTest(test, "creates and deletes a live Neon branch", providerLiveTestGate("neon"), async () => {
    const capsule = new Capsule({
      adapter: neon({
        apiKey: process.env.NEON_API_KEY,
        databaseName: process.env.NEON_DATABASE,
        roleName: process.env.NEON_ROLE,
        pooled: process.env.NEON_POOLED === "1"
      }),
      receipts: true
    });
    const name = `capsule-live-${Date.now().toString(36)}`;
    let branchId: string | undefined;

    try {
      const branch = await capsule.database.branch.create({
        project: process.env.NEON_PROJECT_ID ?? "",
        parent: process.env.NEON_PARENT_BRANCH_ID,
        name,
        ttlMs: 30 * 60 * 1000,
        labels: { "capsule.dev/live-test": "true" }
      });
      branchId = branch.id;
      expect(branch.status).toBe("ready");
      expect(branch.receipt?.type).toBe("database.branch.create");
    } finally {
      if (branchId) {
        const deleted = await capsule.database.branch.delete({ project: process.env.NEON_PROJECT_ID ?? "", branchId, hardDelete: true });
        expect(deleted.status).toBe("deleted");
      }
    }
  }, 120_000);
});
