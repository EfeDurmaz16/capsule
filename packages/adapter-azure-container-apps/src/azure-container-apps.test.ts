import { describe, expect, test } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
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
    expect(azureContainerAppsCapabilities.job?.logs).toBe("unsupported");
    expect(azureContainerAppsCapabilities.service?.deploy).toBe("native");
    expect(azureContainerAppsCapabilities.service?.delete).toBe("unsupported");
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
    expect(calls[0]?.url).toBe("https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/api?api-version=2025-01-01");
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
      if (String(url).endsWith("/start?api-version=2025-01-01")) {
        return response({ id: "/jobs/smoke/executions/exec-1", name: "exec-1", properties: { runningStatus: "Running" } });
      }
      return response({ id: "/jobs/smoke", name: "smoke", properties: { provisioningState: "Succeeded" } }, 201);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: azureContainerApps({ ...options, fetch: fetchMock }), receipts: true });

    const run = await capsule.job.run({ name: "smoke", image: "node:22", command: "node smoke.js", timeoutMs: 60_000, env: { NODE_ENV: "test" } });

    expect(run).toMatchObject({ id: "/jobs/smoke/executions/exec-1", provider: "azure-container-apps", status: "running" });
    expect(run.receipt?.type).toBe("job.run");
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["PUT", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke?api-version=2025-01-01"],
      ["POST", "https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/smoke/start?api-version=2025-01-01"]
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      properties: {
        configuration: { triggerType: "Manual", replicaTimeout: 60 },
        template: { containers: [{ name: "smoke", image: "node:22", command: ["sh", "-lc", "node smoke.js"], env: [{ name: "NODE_ENV", value: "test" }] }] }
      }
    });
  });
});
