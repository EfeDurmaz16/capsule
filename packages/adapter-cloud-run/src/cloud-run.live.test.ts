import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveTest, liveTestGate } from "@capsule/test-utils";
import { cloudRun } from "./index.js";

describe("cloud run live smoke", () => {
  liveTest(
    test,
    "reads a live Cloud Run service status",
    liveTestGate({
      provider: "cloud-run",
      credentials: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN", "CAPSULE_CLOUD_RUN_SERVICE_ID"]
    }),
    async () => {
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: process.env.GOOGLE_CLOUD_PROJECT,
          location: process.env.GOOGLE_CLOUD_RUN_LOCATION,
          accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN
        }),
        receipts: true
      });

      const status = await capsule.service.status({ id: process.env.CAPSULE_CLOUD_RUN_SERVICE_ID ?? "" });
      expect(status.provider).toBe("cloud-run");
      expect(status.receipt?.type).toBe("service.status");
    },
    60_000
  );
});
