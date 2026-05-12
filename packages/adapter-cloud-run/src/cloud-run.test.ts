import { describe, expect, it } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { cloudRun, cloudRunCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("cloud-run adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(cloudRun({}));
  });

  it("declares job and service capabilities", () => {
    expect(cloudRunCapabilities.job?.run).toBe("native");
    expect(cloudRunCapabilities.service?.deploy).toBe("native");
    expect(cloudRunCapabilities.edge?.deploy).toBe("unsupported");
  });

  it("creates and runs a Cloud Run job", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) return response({ name: "operations/run", done: true, response: { name: "execution-1" } });
      if (String(url).includes(":run")) return response({ name: "operations/run", done: false });
      return response({ name: "operations/create", done: true });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "us-central1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const run = await capsule.job.run({
      name: "capsule-job",
      image: "us-docker.pkg.dev/proj/repo/job:latest",
      command: ["node", "job.js"],
      env: { MESSAGE: "hi" },
      timeoutMs: 60_000,
      resources: { cpu: 1, memoryMb: 512 }
    });

    expect(run.status).toBe("succeeded");
    expect(run.receipt?.type).toBe("job.run");
    expect(calls[0]?.url).toContain("/projects/proj/locations/us-central1/jobs?jobId=capsule-job");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      template: { template: { timeout: "60s", containers: [{ command: ["node"], args: ["job.js"], env: [{ name: "MESSAGE", value: "hi" }] }] } }
    });
    expect(calls[1]?.url).toContain("/jobs/capsule-job:run");
    expect(calls[2]?.url).toContain("/operations/run:wait");
  });

  it("deploys a Cloud Run service and returns URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) return response({ name: "operations/svc", done: true, response: { uri: "https://svc.example" } });
      if (init?.method === "GET") return response({ name: "svc", uri: "https://svc.example" });
      return response({ name: "operations/svc", done: true });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const deployment = await capsule.service.deploy({
      name: "api",
      image: "europe-docker.pkg.dev/proj/repo/api:latest",
      ports: [{ port: 8080, protocol: "http" }],
      scale: { min: 0, max: 3 }
    });

    expect(deployment.status).toBe("ready");
    expect(deployment.url).toBe("https://svc.example");
    expect(deployment.receipt?.type).toBe("service.deploy");
    expect(calls[0]?.url).toContain("/projects/proj/locations/europe-west1/services?serviceId=api");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      template: { scaling: { minInstanceCount: 0, maxInstanceCount: 3 } }
    });
  });

  it("requires project and location only when used", async () => {
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "", location: "", accessToken: "token" }) });
    await expect(capsule.job.run({ image: "image" })).rejects.toThrow("Cloud Run adapter requires projectId");
  });
});
