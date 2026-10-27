// Audit regressions for the M1 campaign (Azure Container Apps). Each test asserts the INTENDED behavior
// from the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The
// owner who fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake; no ARM
// endpoint is contacted.
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, CleanupFailureError, PartialEffectsError, PendingOperationError, partialEffectsOf } from "@capsule-sdk/core";
import { azureContainerApps } from "./index.js";

describe("M1 audit regressions: azure", () => {
  it("SVC-05a: an ARM 202 Accepted delete is pending, never deleted", async () => {
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

  const scope = { accessToken: "fake", subscriptionId: "s", resourceGroupName: "r" };
  const appPath = "https://management.azure.com/subscriptions/s/resourceGroups/r/providers/Microsoft.App/containerApps/app?api-version=2025-07-01";

  it("SVC-05a: a 202 delete still in progress at the deadline is PendingOperationError with the locator", async () => {
    const capsule = new Capsule({
      adapter: azureContainerApps({
        ...scope,
        operationDeadlineMs: 50,
        operationPollIntervalMs: 5,
        fetch: async (url) =>
          String(url).includes("/operationStatuses/")
            ? new Response(JSON.stringify({ status: "InProgress" }), { status: 200 })
            : new Response(null, { status: 202, headers: { "azure-asyncoperation": "https://management.azure.com/operationStatuses/x" } })
      })
    });
    const error = await capsule.service.delete({ id: "app" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(error).toMatchObject({
      state: "InProgress",
      resource: { kind: "containerApp", nativeId: "app", scope: { subscriptionId: "s", resourceGroupName: "r" } }
    });
  });

  it("SVC-05a: a 202 delete that ends Failed is a failure, and one without polling headers is confirmed by a 404", async () => {
    const failed = new Capsule({
      adapter: azureContainerApps({
        ...scope,
        fetch: async (url) =>
          String(url).includes("/operationStatuses/")
            ? new Response(JSON.stringify({ status: "Failed", error: { message: "locked" } }), { status: 200 })
            : new Response(null, { status: 202, headers: { "azure-asyncoperation": "https://management.azure.com/operationStatuses/x" } })
      })
    });
    const error = await failed.service.delete({ id: "app" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as Error).message).toMatch(/Failed: locked/);

    const reads: string[] = [];
    const absent = new Capsule({
      adapter: azureContainerApps({
        ...scope,
        operationPollIntervalMs: 1,
        fetch: async (url, init) => {
          if ((init?.method ?? "GET") === "DELETE") return new Response(null, { status: 202 });
          reads.push(String(url));
          return reads.length < 2
            ? new Response(JSON.stringify({ properties: { provisioningState: "Deleting" } }), { status: 200 })
            : new Response(JSON.stringify({ error: { code: "ResourceNotFound", message: "gone" } }), { status: 404 });
        }
      })
    });
    await expect(absent.service.delete({ id: "app" })).resolves.toMatchObject({ status: "deleted", metadata: { outcome: "deleted" } });
    expect(reads).toEqual([appPath, appPath]);
  });

  it("SVC-05a: polling URLs on another origin are never called with the bearer token", async () => {
    const urls: string[] = [];
    const capsule = new Capsule({
      adapter: azureContainerApps({
        ...scope,
        operationPollIntervalMs: 1,
        fetch: async (url, init) => {
          urls.push(String(url));
          if ((init?.method ?? "GET") === "DELETE") return new Response(null, { status: 202, headers: { location: "https://attacker.example/poll" } });
          return new Response(JSON.stringify({ error: { message: "gone" } }), { status: 404 });
        }
      })
    });
    await expect(capsule.service.delete({ id: "app" })).resolves.toMatchObject({ status: "deleted" });
    expect(urls.some((url) => url.startsWith("https://attacker.example"))).toBe(false);
  });

  describe("SVC-05b: generated-job cleanup after a failed start", () => {
    function startFailure(deleteResponse: () => Response, extra: Record<string, unknown> = {}) {
      return new Capsule({
        adapter: azureContainerApps({
          ...scope,
          location: "westeurope",
          environmentId: "env",
          operationDeadlineMs: 50,
          operationPollIntervalMs: 5,
          ...extra,
          fetch: async (url, init) => {
            const method = init?.method ?? "GET";
            if (method === "POST") return new Response(JSON.stringify({ error: { message: "start rejected" } }), { status: 409 });
            if (method === "DELETE") return deleteResponse();
            if (String(url).includes("/operationStatuses/")) return new Response(JSON.stringify({ status: "InProgress" }), { status: 200 });
            return new Response(JSON.stringify({ id: "/jobs/x", name: "x" }), { status: 201 });
          }
        })
      });
    }

    it("reports a cleanup that is still pending as pending, not deleted", async () => {
      const capsule = startFailure(
        () => new Response(null, { status: 202, headers: { "azure-asyncoperation": "https://management.azure.com/operationStatuses/c" } })
      );
      const error = await capsule.job.run({ image: "i" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PartialEffectsError);
      expect((error as { cleanup?: { status?: string } }).cleanup?.status).toBe("pending");
      const effects = partialEffectsOf(error)!;
      expect(effects).toMatchObject({ operation: "job.run", outcome: "failed", cleanup: { status: "pending" } });
      expect(effects.cleanup.residual?.[0]).toMatchObject({ kind: "job", scope: { subscriptionId: "s", resourceGroupName: "r" } });
      expect((effects.primaryError as Error).message).toBe("start rejected");
    });

    it("keeps the job identity and both errors when cleanup fails", async () => {
      const capsule = startFailure(() => new Response(JSON.stringify({ error: { message: "cleanup denied" } }), { status: 403 }));
      const error = await capsule.job.run({ image: "i" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CleanupFailureError);
      expect(partialEffectsOf(error)).toMatchObject({ outcome: "failed", cleanup: { status: "failed", residual: [{ kind: "job" }] } });
    });
  });

  it("GAP-07: a healthcheck the template cannot express is rejected before any request", async () => {
    const urls: string[] = [];
    const capsule = new Capsule({
      adapter: azureContainerApps({
        ...scope,
        location: "westeurope",
        environmentId: "env",
        fetch: async (url) => {
          urls.push(String(url));
          return new Response(JSON.stringify({ id: "/x", name: "app", properties: { provisioningState: "Succeeded" } }), { status: 200 });
        }
      })
    });
    expect(capsule.capabilities().service?.healthcheck).toBe("unsupported");
    await expect(capsule.service.deploy({ name: "app", image: "i", healthcheck: { path: "/healthz" } })).rejects.toThrow(/healthcheck/);
    await expect(capsule.service.deploy({ name: "app", image: "i", healthcheck: { command: ["true"] } })).rejects.toThrow(/healthcheck/);
    expect(urls).toEqual([]);
  });

  describe("GAP-10: ARM ids are checked against the configured subscription and resource group", () => {
    function scopeCapsule() {
      const urls: string[] = [];
      const capsule = new Capsule({
        adapter: azureContainerApps({
          ...scope,
          fetch: async (url) => {
            urls.push(String(url));
            return new Response(JSON.stringify({ id: "/x", name: "app", properties: { provisioningState: "Succeeded", status: "Running" } }), { status: 200 });
          }
        })
      });
      return { capsule, urls };
    }
    const other = "/subscriptions/other/resourceGroups/r/providers/Microsoft.App";

    it("rejects ids from another subscription or resource group before any request", async () => {
      const { capsule, urls } = scopeCapsule();
      await expect(capsule.service.status({ id: `${other}/containerApps/app` })).rejects.toThrow(/outside the configured subscription/);
      await expect(capsule.service.delete({ id: "/subscriptions/s/resourceGroups/elsewhere/providers/Microsoft.App/containerApps/app" })).rejects.toThrow(
        /outside the configured subscription/
      );
      await expect(capsule.job.status({ id: `${other}/jobs/j/executions/e` })).rejects.toThrow(/outside the configured subscription/);
      await expect(capsule.job.cancel({ id: `${other}/jobs/j/executions/e` })).rejects.toThrow(/outside the configured subscription/);
      expect(urls).toEqual([]);
    });

    it("rejects partial ids and names with path characters instead of trimming them", async () => {
      const { capsule, urls } = scopeCapsule();
      await expect(capsule.service.status({ id: "/containerApps/app" })).rejects.toThrow(/must be a resource name or a full ARM resource id/);
      await expect(capsule.service.status({ id: "/subscriptions/s/resourceGroups/r/providers/Microsoft.App/jobs/app" })).rejects.toThrow(
        /not a valid ARM container app id/
      );
      await expect(capsule.job.status({ id: "a/b", providerOptions: { jobName: "j" } })).rejects.toThrow(/must be a resource name/);
      expect(urls).toEqual([]);
    });

    it("accepts in-scope ids case-insensitively, as ARM does", async () => {
      const { capsule, urls } = scopeCapsule();
      await capsule.service.status({ id: "/subscriptions/S/resourcegroups/R/providers/microsoft.app/containerapps/app" });
      await capsule.job.status({ id: "/subscriptions/s/resourceGroups/r/providers/Microsoft.App/jobs/j/executions/e" });
      expect(urls).toEqual([
        "https://management.azure.com/subscriptions/s/resourceGroups/r/providers/Microsoft.App/containerApps/app?api-version=2025-07-01",
        "https://management.azure.com/subscriptions/s/resourceGroups/r/providers/Microsoft.App/jobs/j/executions/e?api-version=2025-07-01"
      ]);
    });
  });
});
