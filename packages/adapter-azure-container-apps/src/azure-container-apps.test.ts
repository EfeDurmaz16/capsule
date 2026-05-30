import { describe, expect, test } from "vitest";
import { AdapterExecutionError, Capsule, runAdapterContract } from "@capsule/core";
import { azureContainerApps, azureContainerAppsCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const options = {
  accessToken: "azure-token",
  subscriptionId: "sub-1",
  resourceGroupName: "rg-1",
  location: "eastus",
  environmentId: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/managedEnvironments/env-1"
};

describe("azure container apps adapter", () => {
  test("runs the shared adapter contract suite", async () => {
    await runAdapterContract(azureContainerApps(options));
  });

  test("declares job and service support honestly", () => {
    expect(azureContainerAppsCapabilities.job?.run).toBe("native");
    expect(azureContainerAppsCapabilities.job?.status).toBe("native");
    expect(azureContainerAppsCapabilities.job?.cancel).toBe("native");
    expect(azureContainerAppsCapabilities.job?.logs).toBe("unsupported");
    expect(azureContainerAppsCapabilities.service?.deploy).toBe("native");
    expect(azureContainerAppsCapabilities.service?.status).toBe("native");
    expect(azureContainerAppsCapabilities.service?.delete).toBe("native");
    expect(azureContainerAppsCapabilities.service?.rollback).toBe("unsupported");
  });

  test("deploys a Container App service", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({
        id: "/containerApps/api",
        name: "api",
        properties: { provisioningState: "Succeeded", configuration: { ingress: { fqdn: "api.example.azurecontainerapps.io" } } }
      }, 201);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const deployment = await capsule.service.deploy({
      name: "api",
      image: "ghcr.io/acme/api:latest",
      ports: [{ port: 8080, public: true, protocol: "http" }],
      resources: { cpu: 0.5, memoryMb: 1024 }
    });

    expect(deployment).toMatchObject({ id: "/containerApps/api", provider: "azure-container-apps", status: "ready", url: "https://api.example.azurecontainerapps.io" });
    expect(deployment.receipt?.type).toBe("service.deploy");
    expect(calls[0]?.url).toBe("https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/api?api-version=2025-07-01");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer azure-token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      location: "eastus",
      properties: {
        environmentId: options.environmentId,
        configuration: { ingress: { external: true, targetPort: 8080, transport: "http" } },
        template: { containers: [{ name: "api", image: "ghcr.io/acme/api:latest", resources: { cpu: 0.5, memory: "1Gi" } }] }
      }
    });
  });

  test("creates and starts a Container Apps Job", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if ((init?.method ?? "GET") === "GET") {
        return response({ error: { message: "job not found" } }, 404);
      }
      if (String(url).endsWith("/start?api-version=2025-07-01")) {
        return response({ id: "/jobs/smoke/executions/exec-1", name: "exec-1", properties: { runningStatus: "Running" } });
      }
      return response({ id: "/jobs/smoke", name: "smoke", properties: { provisioningState: "Succeeded" } }, 201);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const run = await capsule.job.run({ name: "smoke", image: "node:22", command: "node smoke.js", timeoutMs: 60_000, env: { NODE_ENV: "test" } });

    expect(run).toMatchObject({ id: "/jobs/smoke/executions/exec-1", provider: "azure-container-apps", status: "running" });
    expect(run.receipt?.type).toBe("job.run");
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["GET", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke?api-version=2025-07-01"],
      ["PUT", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke?api-version=2025-07-01"],
      ["POST", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke/start?api-version=2025-07-01"]
    ]);
    expect(calls[1]?.init.headers).toMatchObject({ "if-none-match": "*" });
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      properties: {
        configuration: { triggerType: "Manual", replicaTimeout: 60 },
        template: { containers: [{ name: "smoke", image: "node:22", command: ["sh", "-lc", "node smoke.js"], env: [{ name: "NODE_ENV", value: "test" }] }] }
      }
    });
  });

  test("rejects user-named Container Apps Job runs when the Job already exists", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ id: "/jobs/smoke", name: "smoke", properties: { provisioningState: "Succeeded" } });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    await expect(capsule.job.run({ name: "smoke", image: "node:22" })).rejects.toThrow(
      "Azure Container Apps job.run refuses to update existing Job smoke without providerOptions.allowExistingJobUpdate."
    );

    expect(calls.map((call) => [call.init.method ?? "GET", call.url])).toEqual([
      ["GET", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke?api-version=2025-07-01"]
    ]);
  });

  test("allows explicitly requested user-named Container Apps Job updates", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/start?api-version=2025-07-01")) {
        return response({ id: "/jobs/smoke/executions/exec-1", name: "exec-1", properties: { runningStatus: "Running" } });
      }
      return response({ id: "/jobs/smoke", name: "smoke", properties: { provisioningState: "Succeeded" } });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const run = await capsule.job.run({ name: "smoke", image: "node:22", providerOptions: { allowExistingJobUpdate: true } });

    expect(run).toMatchObject({ id: "/jobs/smoke/executions/exec-1", provider: "azure-container-apps", status: "running" });
    expect(calls[0]?.init.headers).not.toMatchObject({ "if-none-match": "*" });
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["PUT", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke?api-version=2025-07-01"],
      ["POST", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke/start?api-version=2025-07-01"]
    ]);
  });

  test("deletes generated Container Apps Jobs when execution start fails", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let jobName = "";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: requestUrl, init: init ?? {} });
      const matchedJobName = requestUrl.match(/\/jobs\/([^/?]+)/)?.[1];
      if (matchedJobName) jobName = decodeURIComponent(matchedJobName);
      if (method === "POST" && requestUrl.endsWith("/start?api-version=2025-07-01")) {
        return response({ error: { message: "Azure start failed" } }, 409);
      }
      if (method === "DELETE") {
        return response(undefined, 202);
      }
      return response({ id: `/jobs/${jobName}`, name: jobName, properties: { provisioningState: "Succeeded" } }, 201);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    let thrown: unknown;
    try {
      await capsule.job.run({ image: "node:22" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AdapterExecutionError);
    expect((thrown as Error).message).toBe("Azure start failed");
    expect((thrown as { cleanup?: Record<string, unknown> }).cleanup).toMatchObject({
      action: "delete-generated-job",
      jobName,
      status: "deleted",
      resourceGroupName: "rg-1",
      subscriptionId: "sub-1"
    });
    expect(calls[0]?.init.headers).toMatchObject({ "if-none-match": "*" });
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["PUT", `https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/${jobName}?api-version=2025-07-01`],
      ["POST", `https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/${jobName}/start?api-version=2025-07-01`],
      ["DELETE", `https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/${jobName}?api-version=2025-07-01`]
    ]);
  });

  test("reads Container Apps Job execution status through ARM", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const executionId = "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke/executions/exec-1";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ id: executionId, name: "exec-1", properties: { status: "Succeeded" } });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const status = await capsule.job.status({ id: executionId });

    expect(status).toMatchObject({ id: executionId, provider: "azure-container-apps", status: "succeeded" });
    expect(status.receipt?.type).toBe("job.status");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke/executions/exec-1?api-version=2025-07-01"
    );
  });

  test("cancels Container Apps Job executions through ARM stop", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response(undefined, 202);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const cancelled = await capsule.job.cancel({ id: "exec-1", reason: "cleanup", providerOptions: { jobName: "smoke" } });

    expect(cancelled).toMatchObject({ id: "exec-1", provider: "azure-container-apps", status: "cancelling" });
    expect(cancelled.receipt?.type).toBe("job.cancel");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe(
      "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke/executions/exec-1/stop?api-version=2025-07-01"
    );
  });

  test("reads Container App service status and records a receipt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({
        id: "/containerApps/api",
        name: "api",
        properties: { provisioningState: "Succeeded", configuration: { ingress: { fqdn: "api.example.azurecontainerapps.io" } } }
      });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const status = await capsule.service.status({ id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/api" });

    expect(status).toMatchObject({ id: "/containerApps/api", provider: "azure-container-apps", name: "api", status: "ready", url: "https://api.example.azurecontainerapps.io" });
    expect(status.receipt?.type).toBe("service.status");
    expect(calls[0]?.url).toBe("https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/api?api-version=2025-07-01");
  });

  test("deletes Container App services through ARM", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response(undefined, 202);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const deleted = await capsule.service.delete({ id: "api", reason: "cleanup" });

    expect(deleted).toMatchObject({ id: "api", provider: "azure-container-apps", name: "api", status: "deleted" });
    expect(deleted.receipt?.type).toBe("service.delete");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/api?api-version=2025-07-01");
  });

  test("keeps generic revision rollback unsupported", async () => {
    const capsule = new Capsule({ adapter: azureContainerApps(options) });

    expect(capsule.capabilities().service?.rollback).toBe("unsupported");
    await expect(capsule.edge.rollback({ deploymentId: "api--rev1" })).rejects.toThrow("Capability is unsupported: edge.rollback");
  });
});
