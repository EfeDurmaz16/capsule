import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { liveResourceMetadata, liveTest, liveTestGate } from "@capsule-sdk/test-utils";
import { fly } from "./index.js";

describe("fly live smoke", () => {
  liveTest(
    test,
    "creates and destroys a live Fly Machine",
    liveTestGate({ provider: "fly", credentials: ["FLY_API_TOKEN", "FLY_APP_NAME", "CAPSULE_FLY_IMAGE"] }),
    async () => {
      const capsule = new Capsule({
        adapter: fly({
          apiToken: process.env.FLY_API_TOKEN,
          appName: process.env.FLY_APP_NAME,
          region: process.env.FLY_REGION,
          memoryMb: Number(process.env.CAPSULE_FLY_MEMORY_MB ?? 256),
          cpus: Number(process.env.CAPSULE_FLY_CPUS ?? 1)
        }),
        receipts: true
      });
      let machineId: string | undefined;
      const liveResource = liveResourceMetadata({ provider: "fly", resource: "machine" });

      try {
        const machine = await capsule.machine.create({
          name: liveResource.name,
          image: process.env.CAPSULE_FLY_IMAGE,
          labels: liveResource.labels
        });
        machineId = machine.id;
        expect(machine.provider).toBe("fly");
        expect(machine.receipt?.type).toBe("machine.create");
        expect(machine.receipt?.metadata).toMatchObject({
          providerApiVersion: "machines/v1",
          providerRegion: expect.any(String),
          runtimeVersion: process.version,
          adapterVersion: "0.1.1"
        });
      } finally {
        if (machineId) {
          await capsule.machine.destroy({ id: machineId, force: true, reason: "capsule live smoke cleanup" });
        }
      }
    },
    120_000
  );
});
