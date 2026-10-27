// Audit regressions for the M1 campaign (Azure Container Apps). Each test asserts the INTENDED behavior
// from the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The
// owner who fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake; no ARM
// endpoint is contacted.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { azureContainerApps } from "./index.js";

describe("M1 audit regressions: azure", () => {
  it.fails("SVC-05a: an ARM 202 Accepted delete is pending, never deleted", async () => {
    const capsule = new Capsule({
      adapter: azureContainerApps({
        accessToken: "fake",
        subscriptionId: "s",
        resourceGroupName: "r",
        fetch: async () => new Response(null, { status: 202, headers: { location: "https://management.azure.com/operations/fake", "retry-after": "1" } })
      })
    });
    const outcome = await Promise.race([
      capsule.service.delete({ id: "app" }).then(
        (value) => ({ state: "resolved" as const, status: value.status }),
        () => ({ state: "rejected" as const, status: undefined })
      ),
      new Promise<{ state: "pending"; status: undefined }>((resolve) => setTimeout(() => resolve({ state: "pending", status: undefined }), 1000))
    ]);
    expect(outcome.state === "resolved" && outcome.status === "deleted").toBe(false);
  });
});
