import { describe, expect, it } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { CloudRunClient, cloudRun, cloudRunCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("cloud-run adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(cloudRun({}));
  });

  it("declares job and service capabilities", () => {
    expect(cloudRunCapabilities.job?.run).toBe("native");
    expect(cloudRunCapabilities.job?.status).toBe("native");
    expect(cloudRunCapabilities.job?.cancel).toBe("native");
    expect(cloudRunCapabilities.job?.logs).toBe("native");
    expect(cloudRunCapabilities.service?.deploy).toBe("native");
    expect(cloudRunCapabilities.service?.update).toBe("native");
    expect(cloudRunCapabilities.service?.status).toBe("native");
    expect(cloudRunCapabilities.service?.delete).toBe("native");
    expect(cloudRunCapabilities.service?.logs).toBe("native");
    expect(cloudRunCapabilities.service?.rollback).toBe("native");
    expect(cloudRunCapabilities.edge?.deploy).toBe("unsupported");
  });

  it("creates and runs a Cloud Run job", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) {
        return response({
          name: "operations/run",
          done: true,
          response: { name: "projects/proj/locations/us-central1/jobs/capsule-job/executions/execution-1", completionStatus: "EXECUTION_SUCCEEDED" }
        });
      }
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
    expect(run.id).toBe("projects/proj/locations/us-central1/jobs/capsule-job/executions/execution-1");
    expect(run.receipt?.type).toBe("job.run");
    expect(calls[0]?.url).toContain("/projects/proj/locations/us-central1/jobs?jobId=capsule-job");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      template: { template: { timeout: "60s", containers: [{ command: ["node"], args: ["job.js"], env: [{ name: "MESSAGE", value: "hi" }] }] } }
    });
    expect(calls[1]?.url).toContain("/jobs/capsule-job:run");
    expect(calls[2]?.url).toContain("/operations/run:wait");
  });

  it("maps Cloud Run execution status and cancel requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const execution = "projects/proj/locations/us-central1/jobs/capsule-job/executions/execution-1";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":cancel")) return response({ name: execution, completionStatus: "EXECUTION_CANCELLED" });
      return response({ name: execution, completionStatus: "EXECUTION_RUNNING", runningCount: 1, taskCount: 1 });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "us-central1", accessToken: "token", fetch: fetchMock })
    });

    await expect(capsule.job.status({ id: execution })).resolves.toMatchObject({ id: execution, provider: "cloud-run", status: "running" });
    await expect(capsule.job.cancel({ id: execution })).resolves.toMatchObject({ id: execution, provider: "cloud-run", status: "cancelled" });
    expect(calls[0]).toMatchObject({ url: expect.stringContaining(`/v2/${execution}`), init: { method: "GET" } });
    expect(calls[1]).toMatchObject({ url: expect.stringContaining(`/v2/${execution}:cancel`), init: { method: "POST", body: "{}" } });
  });

  it("maps Cloud Run execution delete request without treating it as cancel", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const execution = "projects/proj/locations/us-central1/jobs/capsule-job/executions/execution-1";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ name: "operations/delete", done: true });
    }) as typeof fetch;
    const client = new CloudRunClient({ projectId: "proj", location: "us-central1", accessToken: "token", fetch: fetchMock });

    await expect(client.deleteExecution(execution)).resolves.toMatchObject({ name: "operations/delete", done: true });
    expect(calls[0]).toMatchObject({ url: expect.stringContaining(`/v2/${execution}`), init: { method: "DELETE" } });
  });

  it("fetches Cloud Run job logs through Cloud Logging and redacts configured secrets", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const execution = "projects/proj/locations/us-central1/jobs/capsule-job/executions/execution-1";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({
        entries: [
          {
            logName: "projects/proj/logs/run.googleapis.com%2Fstdout",
            timestamp: "2026-01-01T00:00:02.000Z",
            textPayload: "ready secret-value"
          },
          {
            logName: "projects/proj/logs/run.googleapis.com%2Fstderr",
            timestamp: "2026-01-01T00:00:01.000Z",
            jsonPayload: { error: "bad secret-value" }
          }
        ]
      });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "proj",
        location: "us-central1",
        accessToken: "token",
        fetch: fetchMock,
        logRedactionEnv: { TOKEN: "secret-value" }
      }),
      policy: { secrets: { allowed: ["TOKEN"], redactFromLogs: true } },
      receipts: true
    });

    const logs = await capsule.job.logs({
      id: execution,
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-01T00:05:00.000Z",
      limit: 25
    });

    expect(logs.logs).toEqual([
      { timestamp: "2026-01-01T00:00:02.000Z", stream: "stdout", message: "ready [REDACTED]" },
      { timestamp: "2026-01-01T00:00:01.000Z", stream: "stderr", message: '{"error":"bad [REDACTED]"}' }
    ]);
    expect(logs.receipt).toMatchObject({ type: "job.logs", capabilityPath: "job.logs" });
    expect(calls[0]).toMatchObject({ url: "https://logging.googleapis.com/v2/entries:list", init: { method: "POST" } });
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer token", "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      resourceNames: ["projects/proj"],
      filter:
        'resource.type="cloud_run_job" AND resource.labels.project_id="proj" AND resource.labels.location="us-central1" AND resource.labels.job_name="capsule-job" AND labels.execution_name="execution-1" AND timestamp>="2026-01-01T00:00:00.000Z" AND timestamp<="2026-01-01T00:05:00.000Z"',
      orderBy: "timestamp desc",
      pageSize: 25
    });
  });

  it("fetches Cloud Run service logs through Cloud Logging", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({
        entries: [
          {
            logName: "projects/proj/logs/run.googleapis.com%2Fvarlog%2Fsystem",
            receiveTimestamp: "2026-01-01T00:00:01.000Z",
            textPayload: "started"
          }
        ]
      });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const logs = await capsule.service.logs({ id: "projects/proj/locations/europe-west1/services/api", limit: 10 });

    expect(logs).toMatchObject({
      id: "projects/proj/locations/europe-west1/services/api",
      provider: "cloud-run",
      name: "projects/proj/locations/europe-west1/services/api",
      logs: [{ timestamp: "2026-01-01T00:00:01.000Z", stream: "system", message: "started" }]
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      resourceNames: ["projects/proj"],
      filter:
        'resource.type="cloud_run_revision" AND resource.labels.project_id="proj" AND resource.labels.location="europe-west1" AND resource.labels.service_name="api"',
      orderBy: "timestamp desc",
      pageSize: 10
    });
  });

  it("fails explicitly instead of returning fake logs when Cloud Logging configuration is missing", async () => {
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "", location: "us-central1", accessToken: "token" }) });

    await expect(capsule.service.logs({ id: "api" })).rejects.toThrow("Cloud Run adapter requires projectId");
  });

  it("rejects follow mode because Cloud Logging entries:list is a bounded read", async () => {
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "proj", location: "us-central1", accessToken: "token" }) });

    await expect(capsule.job.logs({ id: "capsule-job", follow: true })).rejects.toThrow("Cloud Run logs follow is not supported");
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

  it("maps Cloud Run service status to ready, deploying, and failed states", async () => {
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const states = [
      {
        name: serviceName,
        uri: "https://api.example",
        reconciling: false,
        terminalCondition: { state: "CONDITION_SUCCEEDED" },
        latestReadyRevision: `${serviceName}/revisions/api-00002-def`,
        latestCreatedRevision: `${serviceName}/revisions/api-00002-def`
      },
      { name: serviceName, reconciling: true, terminalCondition: { state: "CONDITION_RECONCILING" } },
      { name: serviceName, reconciling: false, terminalCondition: { state: "CONDITION_FAILED", message: "revision failed" } }
    ];
    const fetchMock = (async () => response(states.shift())) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const ready = await capsule.service.status({ id: "api" });
    const deploying = await capsule.service.status({ id: "api" });
    const failed = await capsule.service.status({ id: "api" });

    expect(ready).toMatchObject({ id: "api", provider: "cloud-run", name: serviceName, status: "ready", url: "https://api.example" });
    expect(ready.receipt).toMatchObject({
      type: "service.status",
      capabilityPath: "service.status",
      resource: { id: "api", name: serviceName, status: "ready", url: "https://api.example" }
    });
    expect(ready.metadata?.service).toMatchObject({ latestReadyRevision: `${serviceName}/revisions/api-00002-def` });
    expect(deploying.status).toBe("deploying");
    expect(failed.status).toBe("failed");
  });

  it("updates a Cloud Run service through services.patch with revision metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) {
        return response({ name: "operations/update", done: true, response: { name: serviceName, uri: "https://api.example", latestReadyRevision: `${serviceName}/revisions/api-00003-ghi` } });
      }
      if (init?.method === "GET") {
        return response({ name: serviceName, uri: "https://api.example", latestReadyRevision: `${serviceName}/revisions/api-00003-ghi` });
      }
      return response({ name: "operations/update", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const deployment = await capsule.service.update({
      id: "api",
      image: "europe-docker.pkg.dev/proj/repo/api:v2",
      env: { VERSION: "v2" },
      scale: { min: 1, max: 4 }
    });

    expect(deployment).toMatchObject({
      id: "api",
      provider: "cloud-run",
      name: serviceName,
      status: "ready",
      url: "https://api.example",
      metadata: { revision: `${serviceName}/revisions/api-00003-ghi`, updateMask: ["template.scaling", "template.containers"] }
    });
    const updateUrl = new URL(calls[0]?.url ?? "");
    expect(updateUrl.pathname).toBe(`/v2/${serviceName}`);
    expect(updateUrl.searchParams.get("updateMask")).toBe("template.scaling,template.containers");
    expect(updateUrl.searchParams.get("forceNewRevision")).toBe("true");
    expect(calls[0]?.init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      name: serviceName,
      template: {
        scaling: { minInstanceCount: 1, maxInstanceCount: 4 },
        containers: [{ image: "europe-docker.pkg.dev/proj/repo/api:v2", env: [{ name: "VERSION", value: "v2" }] }]
      }
    });
    expect(deployment.receipt).toMatchObject({ type: "service.update", capabilityPath: "service.update" });
  });

  it("does not report failed Cloud Run service update operations as ready", async () => {
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(":wait")) {
        return response({
          name: "operations/update",
          done: true,
          response: {
            name: serviceName,
            terminalCondition: { state: "CONDITION_FAILED", message: "revision failed" }
          }
        });
      }
      if (init?.method === "GET") return response({ name: serviceName });
      return response({ name: "operations/update", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock })
    });

    await expect(capsule.service.update({ id: "api", image: "europe-docker.pkg.dev/proj/repo/api:v2" })).resolves.toMatchObject({
      status: "failed"
    });
  });

  it("rejects partial Cloud Run container updates without an image", async () => {
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: async () => response({}) })
    });

    await expect(capsule.service.update({ id: "api", env: { VERSION: "v2" } })).rejects.toThrow(
      "requires image when updating container fields"
    );
  });

  it("allows Cloud Run labels-only service updates", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) return response({ name: "operations/update", done: true, response: { name: serviceName } });
      if (init?.method === "GET") return response({ name: serviceName });
      return response({ name: "operations/update", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock })
    });

    await expect(capsule.service.update({ id: "api", labels: { track: "stable" } })).resolves.toMatchObject({ status: "ready" });
    const updateUrl = new URL(calls[0]?.url ?? "");
    expect(updateUrl.searchParams.get("updateMask")).toBe("labels");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ name: serviceName, labels: { track: "stable" } });
  });

  it("rolls back Cloud Run service traffic to an explicit revision", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const revision = `${serviceName}/revisions/api-00001-abc`;
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) return response({ name: "operations/rollback", done: true, response: { name: serviceName, uri: "https://api.example" } });
      if (init?.method === "GET") return response({ name: serviceName, uri: "https://api.example", latestReadyRevision: `${serviceName}/revisions/api-00002-def` });
      return response({ name: "operations/rollback", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const deployment = await capsule.service.rollback({ id: "api", revision });

    expect(deployment).toMatchObject({ id: "api", provider: "cloud-run", name: serviceName, status: "ready", metadata: { revision } });
    const patchUrl = new URL(calls[1]?.url ?? "");
    expect(calls[0]).toMatchObject({ url: expect.stringContaining(`/v2/${serviceName}`), init: { method: "GET" } });
    expect(calls[1]?.init).toMatchObject({ method: "PATCH" });
    expect(patchUrl.searchParams.get("updateMask")).toBe("traffic");
    expect(patchUrl.searchParams.get("forceNewRevision")).toBe("false");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      name: serviceName,
      traffic: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision, percent: 100 }]
    });
    expect(deployment.receipt).toMatchObject({ type: "service.rollback", capabilityPath: "service.rollback" });
  });

  it("does not report failed Cloud Run rollback operations as ready", async () => {
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const revision = `${serviceName}/revisions/api-00001-abc`;
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(":wait")) {
        return response({
          name: "operations/rollback",
          done: true,
          response: {
            name: serviceName,
            terminalCondition: { state: "CONDITION_FAILED", message: "traffic update failed" }
          }
        });
      }
      if (init?.method === "GET") return response({ name: serviceName, latestReadyRevision: `${serviceName}/revisions/api-00002-def` });
      return response({ name: "operations/rollback", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock })
    });

    await expect(capsule.service.rollback({ id: "api", revision })).resolves.toMatchObject({ status: "failed" });
  });

  it("selects the previous Cloud Run revision when rollback revision is omitted", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const previous = `${serviceName}/revisions/api-00001-abc`;
    const current = `${serviceName}/revisions/api-00002-def`;
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/revisions")) {
        return response({
          revisions: [
            { name: current, createTime: "2026-01-02T00:00:00.000Z" },
            { name: previous, createTime: "2026-01-01T00:00:00.000Z" }
          ]
        });
      }
      if (String(url).endsWith(":wait")) return response({ name: "operations/rollback", done: true, response: { name: serviceName } });
      if (init?.method === "GET") return response({ name: serviceName, latestReadyRevision: current, latestCreatedRevision: current });
      return response({ name: "operations/rollback", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock })
    });

    await expect(capsule.service.rollback({ id: "api" })).resolves.toMatchObject({ metadata: { revision: previous } });
    expect(calls[1]).toMatchObject({ url: expect.stringContaining(`/v2/${serviceName}/revisions`), init: { method: "GET" } });
    expect(JSON.parse(String(calls[2]?.init.body))).toMatchObject({ traffic: [{ revision: previous, percent: 100 }] });
  });

  it("deletes a Cloud Run service through the Admin API and records a resource receipt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const serviceName = "projects/proj/locations/europe-west1/services/api";
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith(":wait")) return response({ name: "operations/delete", done: true });
      return response({ name: "operations/delete", done: false });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "proj", location: "europe-west1", accessToken: "token", fetch: fetchMock }),
      receipts: true
    });

    const deleted = await capsule.service.delete({ id: "api" });

    expect(deleted).toMatchObject({ id: "api", provider: "cloud-run", name: serviceName, status: "deleted" });
    expect(deleted.receipt).toMatchObject({
      type: "service.delete",
      capabilityPath: "service.delete",
      resource: { id: "api", name: serviceName, status: "deleted" }
    });
    expect(calls[0]).toMatchObject({ url: expect.stringContaining(`/v2/${serviceName}`), init: { method: "DELETE" } });
    expect(calls[1]).toMatchObject({ url: expect.stringContaining("/v2/operations/delete:wait"), init: { method: "POST" } });
  });

  it("requires project and location only when used", async () => {
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "", location: "", accessToken: "token" }) });
    await expect(capsule.job.run({ image: "image" })).rejects.toThrow("Cloud Run adapter requires projectId");
  });
});
