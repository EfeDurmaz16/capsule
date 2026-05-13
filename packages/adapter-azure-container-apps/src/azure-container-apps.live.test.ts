import { describe, expect, test } from "vitest";
import { Capsule } from "@capsule/core";
import { liveTest, liveTestGate } from "@capsule/test-utils";
import { azureContainerApps } from "./index.js";

describe("azure container apps live smoke", () => {
  liveTest(
    test,
    "deploys and deletes a live Azure Container App service",
    liveTestGate({
      provider: "azure-container-apps",
      credentials: [
        "AZURE_ACCESS_TOKEN",
        "AZURE_SUBSCRIPTION_ID",
        "AZURE_RESOURCE_GROUP",
        "AZURE_LOCATION",
        "AZURE_CONTAINERAPPS_ENVIRONMENT_ID",
        "CAPSULE_AZURE_CONTAINER_IMAGE"
      ]
    }),
    async () => {
      const capsule = new Capsule({
        adapter: azureContainerApps({
          accessToken: process.env.AZURE_ACCESS_TOKEN,
          subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
          resourceGroupName: process.env.AZURE_RESOURCE_GROUP,
          location: process.env.AZURE_LOCATION,
          environmentId: process.env.AZURE_CONTAINERAPPS_ENVIRONMENT_ID
        }),
        receipts: true
      });
      const name = `capsule-live-${Date.now().toString(36)}`;

      try {
        const service = await capsule.service.deploy({
          name,
          image: process.env.CAPSULE_AZURE_CONTAINER_IMAGE,
          ports: [{ port: Number(process.env.CAPSULE_AZURE_CONTAINER_PORT ?? 8080), public: true, protocol: "http" }],
          labels: { "capsule.dev/live-test": "true" }
        });
        expect(service.provider).toBe("azure-container-apps");
        expect(service.receipt?.type).toBe("service.deploy");
      } finally {
        await capsule.service.delete({ id: name, reason: "capsule live smoke cleanup" }).catch(() => undefined);
      }
    },
    180_000
  );
});
