import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveTest, liveTestGate } from "@capsule/test-utils";
import { vercel } from "./index.js";

describe("vercel live smoke", () => {
  liveTest(
    test,
    "reads a live Vercel deployment status",
    liveTestGate({ provider: "vercel", credentials: ["VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"] }),
    async () => {
      const capsule = new Capsule({
        adapter: vercel({
          token: process.env.VERCEL_TOKEN,
          teamId: process.env.VERCEL_TEAM_ID,
          slug: process.env.VERCEL_TEAM_SLUG,
          projectId: process.env.VERCEL_PROJECT_ID
        }),
        receipts: true
      });

      const status = await capsule.edge.status({ id: process.env.CAPSULE_VERCEL_DEPLOYMENT_ID ?? "" });
      expect(status.provider).toBe("vercel");
      expect(status.receipt?.type).toBe("edge.status");
    },
    60_000
  );
});
