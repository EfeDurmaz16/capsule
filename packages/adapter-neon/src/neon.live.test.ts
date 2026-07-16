import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveResourceMetadata, liveTest, providerLiveTestGate } from "@capsule/test-utils";
import { neon } from "./index.js";

describe("neon live smoke", () => {
  liveTest(
    test,
    "creates and deletes a live Neon branch",
    providerLiveTestGate("neon"),
    async () => {
      const capsule = new Capsule({
        adapter: neon({
          apiKey: process.env.NEON_API_KEY,
          databaseName: process.env.NEON_DATABASE,
          roleName: process.env.NEON_ROLE,
          pooled: process.env.NEON_POOLED === "1"
        }),
        receipts: true
      });
      const liveResource = liveResourceMetadata({ provider: "neon", resource: "branch", ttlMs: 30 * 60 * 1000 });
      const name = liveResource.name;
      let branchId: string | undefined;

      try {
        const branch = await capsule.database.branch.create({
          project: process.env.NEON_PROJECT_ID ?? "",
          parent: process.env.NEON_PARENT_BRANCH_ID,
          name,
          ttlMs: liveResource.ttlMs,
          labels: liveResource.labels
        });
        branchId = branch.id;
        expect(branch.status).toBe("ready");
        if (process.env.NEON_DATABASE && process.env.NEON_ROLE) {
          expect(branch.connectionString).toContain("postgres");
        } else {
          expect(branch.connectionString).toBeUndefined();
        }
        expect(branch.receipt?.type).toBe("database.branch.create");
        expect(branch.receipt?.metadata).toMatchObject({
          providerApiVersion: "v2",
          runtimeVersion: process.version,
          adapterVersion: "0.1.1"
        });
        expect(branch.receipt?.policy.notes).toContain(
          process.env.NEON_DATABASE && process.env.NEON_ROLE
            ? "Connection URI retrieved from Neon API."
            : "Connection URI not requested; configure databaseName and roleName to retrieve it."
        );
      } finally {
        if (branchId) {
          const deleted = await capsule.database.branch.delete({ project: process.env.NEON_PROJECT_ID ?? "", branchId, hardDelete: true });
          expect(deleted.status).toBe("deleted");
        }
      }
    },
    120_000
  );
});
