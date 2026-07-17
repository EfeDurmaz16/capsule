import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { liveResourceMetadata, liveTest, liveTestGate } from "@capsule-sdk/test-utils";
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
      expect(status.receipt?.metadata).toMatchObject({
        providerApiVersion: "run.googleapis.com/v2",
        providerRegion: process.env.GOOGLE_CLOUD_RUN_LOCATION,
        runtimeVersion: process.version,
        adapterVersion: "0.1.1"
      });
    },
    60_000
  );

  // job.run creates and executes a real Cloud Run Job, so this smoke is billable-gated
  // (CAPSULE_LIVE_TEST_COST_ACK=1 and CAPSULE_LIVE_TEST_MAX_RESOURCES) unlike the read-only
  // service.status smoke above. The Cloud Run Job resource persists after execution; it is
  // TTL-labeled so the live cleanup sweep can reclaim it.
  liveTest(
    test,
    "runs a live Cloud Run job",
    liveTestGate({
      provider: "cloud-run",
      credentials: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN", "CAPSULE_CLOUD_RUN_JOB_IMAGE"],
      costRisk: "billable"
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

      const liveResource = liveResourceMetadata({ provider: "cloud-run", resource: "job" });
      const run = await capsule.job.run({
        name: liveResource.name,
        image: process.env.CAPSULE_CLOUD_RUN_JOB_IMAGE ?? "",
        labels: liveResource.labels
      });

      expect(run.provider).toBe("cloud-run");
      expect(run.status).toBe("succeeded");
      expect(run.receipt?.type).toBe("job.run");
      expect(run.receipt?.metadata).toMatchObject({
        providerApiVersion: "run.googleapis.com/v2",
        providerRegion: process.env.GOOGLE_CLOUD_RUN_LOCATION,
        runtimeVersion: process.version,
        adapterVersion: "0.1.1"
      });
    },
    120_000
  );
});
