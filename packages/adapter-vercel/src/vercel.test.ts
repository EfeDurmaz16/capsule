import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, runAdapterContract } from "@capsule/core";
import { vercel, vercelCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function jsonStream(lines: unknown[], status = 200): Response {
  return new Response(lines.map((line) => JSON.stringify(line)).join("\n"), {
    status,
    headers: { "content-type": "application/stream+json" }
  });
}

async function sourceFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-vercel-"));
  const file = join(dir, "index.js");
  await writeFile(file, "export default function handler() { return new Response('ok') }");
  return file;
}

describe("vercel adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(vercel());
  });

  it("declares edge deploy as native", () => {
    expect(vercelCapabilities.edge?.deploy).toBe("native");
    expect(vercelCapabilities.edge?.status).toBe("native");
    expect(vercelCapabilities.edge?.release).toBe("native");
    expect(vercelCapabilities.edge?.version).toBe("unsupported");
    expect(vercelCapabilities.edge?.rollback).toBe("unsupported");
    expect(vercelCapabilities.edge?.logs).toBe("native");
  });

  it("creates an inline deployment", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ id: "dpl_123", name: "capsule-edge", url: "capsule-edge.vercel.app", readyState: "READY" });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: vercel({ token: "vercel-token", teamId: "team_1", project: "capsule-project", fetch: fetchMock }),
      receipts: true
    });

    const deployment = await capsule.edge.deploy({ name: "capsule-edge", source: { path: await sourceFile(), entrypoint: "api/index.js" } });

    expect(deployment).toMatchObject({ id: "dpl_123", provider: "vercel", status: "ready", url: "https://capsule-edge.vercel.app" });
    expect(deployment.receipt?.type).toBe("edge.deploy");
    expect(calls[0]?.url).toBe("https://api.vercel.com/v13/deployments?teamId=team_1");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer vercel-token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      name: "capsule-edge",
      project: "capsule-project",
      target: "preview",
      files: [{ file: "api/index.js", encoding: "utf-8" }]
    });
  });

  it("does not leak token in API errors", async () => {
    const fetchMock = (async () => response({ error: { message: "deployment failed" } }, 400)) as typeof fetch;
    const capsule = new Capsule({ adapter: vercel({ token: "secret-token", fetch: fetchMock }) });
    await expect(capsule.edge.deploy({ name: "bad", source: { path: await sourceFile() } })).rejects.toThrow(AdapterExecutionError);
    await expect(capsule.edge.deploy({ name: "bad", source: { path: await sourceFile() } })).rejects.not.toThrow("secret-token");
  });

  it("fetches deployment status with team query parameters", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ id: "dpl_123", name: "capsule-edge", url: "capsule-edge.vercel.app", readyState: "READY", inspectorUrl: "https://inspect.example" });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: vercel({ token: "vercel-token", teamId: "team_1", fetch: fetchMock }),
      receipts: true
    });

    const status = await capsule.edge.status({ id: "dpl_123" });

    expect(status).toMatchObject({ id: "dpl_123", provider: "vercel", name: "capsule-edge", status: "ready", url: "https://capsule-edge.vercel.app" });
    expect(status.receipt?.type).toBe("edge.status");
    expect(calls[0]).toMatchObject({ url: "https://api.vercel.com/v13/deployments/dpl_123?teamId=team_1", init: { method: "GET" } });
  });

  it("fetches deployment event logs with team and slug query parameters", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response([
        { type: "stdout", created: 1_762_905_600_000, payload: { text: "build started", statusCode: 200 } },
        { type: "stderr", payload: { text: "build failed secret-token", created: 1_762_905_601_000, statusCode: 500 } }
      ]);
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: vercel({ token: "vercel-token", teamId: "team_1", slug: "team-slug", fetch: fetchMock }),
      receipts: true
    });

    const logs = await capsule.edge.logs({
      id: "dpl_123",
      since: "2025-11-11T18:00:00.000Z",
      until: "2025-11-11T19:00:00.000Z",
      limit: 2,
      follow: false,
      providerOptions: { api: "deployment-events", token: "secret-token" }
    });

    expect(logs.logs).toEqual([
      { timestamp: "2025-11-12T00:00:00.000Z", stream: "stdout", message: "build started" },
      { timestamp: "2025-11-12T00:00:01.000Z", stream: "stderr", message: "build failed [REDACTED]" }
    ]);
    expect(logs.receipt?.type).toBe("edge.logs");
    expect(logs.receipt?.providerOptions).toEqual({ api: "deployment-events", token: "[REDACTED]" });
    expect(JSON.stringify(logs.receipt)).not.toContain("secret-token");
    expect(calls[0]).toMatchObject({
      url: "https://api.vercel.com/v3/deployments/dpl_123/events?since=1762884000000&until=1762887600000&limit=2&teamId=team_1&slug=team-slug",
      init: { method: "GET" }
    });
    expect(JSON.stringify(logs)).not.toContain("vercel-token");
    expect(JSON.stringify(logs)).not.toContain("secret-token");
  });

  it("rejects Vercel follow-mode logs until streaming is explicitly modeled", async () => {
    const capsule = new Capsule({ adapter: vercel({ token: "vercel-token" }) });

    await expect(capsule.edge.logs({ id: "dpl_123", follow: true })).rejects.toThrow("follow mode is not supported");
  });

  it("fetches runtime logs only when a real project id is provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response([{ level: "error", message: "runtime failed", timestampInMs: 1_762_905_602_000 }]);
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: vercel({ token: "vercel-token", projectId: "prj_123", teamId: "team_1", fetch: fetchMock }),
      receipts: true
    });

    const logs = await capsule.edge.logs({ id: "dpl_123", providerOptions: { api: "runtime" } });

    expect(logs.logs).toEqual([{ timestamp: "2025-11-12T00:00:02.000Z", stream: "stderr", message: "runtime failed" }]);
    expect(calls[0]).toMatchObject({
      url: "https://api.vercel.com/v1/projects/prj_123/deployments/dpl_123/runtime-logs?teamId=team_1",
      init: { method: "GET" }
    });
  });

  it("parses Vercel runtime log stream responses", async () => {
    const fetchMock = (async () =>
      jsonStream([
        { level: "info", message: "request started secret-token", timestampInMs: 1_762_905_603_000 },
        { level: "error", message: "request failed", timestampInMs: 1_762_905_604_000 }
      ])) as typeof fetch;
    const capsule = new Capsule({
      adapter: vercel({ token: "vercel-token", projectId: "prj_123", fetch: fetchMock }),
      receipts: true
    });

    const logs = await capsule.edge.logs({ id: "dpl_123", providerOptions: { api: "runtime", token: "secret-token" } });

    expect(logs.logs).toEqual([
      { timestamp: "2025-11-12T00:00:03.000Z", stream: "stdout", message: "request started [REDACTED]" },
      { timestamp: "2025-11-12T00:00:04.000Z", stream: "stderr", message: "request failed" }
    ]);
    expect(JSON.stringify(logs)).not.toContain("secret-token");
  });

  it("requires project id before using Vercel runtime logs", async () => {
    const capsule = new Capsule({ adapter: vercel({ token: "vercel-token" }) });

    await expect(capsule.edge.logs({ id: "dpl_123", providerOptions: { api: "runtime" } })).rejects.toThrow("Vercel runtime logs require providerOptions.projectId");
  });

  it("assigns an alias through edge.release", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ uid: "alias_123", alias: "preview.example.com", oldDeploymentId: "dpl_old", created: "2026-05-13T00:00:00.000Z" });
    }) as typeof fetch;
    const capsule = new Capsule({
      adapter: vercel({ token: "vercel-token", teamId: "team_1", slug: "team-slug", fetch: fetchMock }),
      receipts: true
    });

    const release = await capsule.edge.release({ versionId: "dpl_123", alias: "preview.example.com" });

    expect(release).toMatchObject({
      id: "alias_123",
      provider: "vercel",
      versionId: "dpl_123",
      deploymentId: "dpl_123",
      alias: "preview.example.com",
      status: "ready",
      url: "https://preview.example.com"
    });
    expect(release.receipt?.type).toBe("edge.release");
    expect(calls[0]).toMatchObject({
      url: "https://api.vercel.com/v2/deployments/dpl_123/aliases?teamId=team_1&slug=team-slug",
      init: { method: "POST" }
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ alias: "preview.example.com", redirect: null });
  });

  it("requires a token only when used", async () => {
    const capsule = new Capsule({ adapter: vercel({ token: "" }) });
    await expect(capsule.edge.deploy({ name: "missing", source: { path: await sourceFile() } })).rejects.toThrow("Vercel adapter requires a token");
  });
});
