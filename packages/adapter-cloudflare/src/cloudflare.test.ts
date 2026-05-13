import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, runAdapterContract } from "@capsule/core";
import { cloudflare, cloudflareCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function workerFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-cloudflare-"));
  const file = join(dir, "worker.js");
  await writeFile(file, "export default { fetch() { return new Response('ok') } }");
  return file;
}

describe("cloudflare adapter", () => {
  it("runs the shared adapter contract suite", async () => {
    await runAdapterContract(cloudflare());
  });

  it("declares edge deploy as native", () => {
    expect(cloudflareCapabilities.edge?.deploy).toBe("native");
    expect(cloudflareCapabilities.edge?.version).toBe("native");
    expect(cloudflareCapabilities.edge?.rollback).toBe("native");
    expect(cloudflareCapabilities.edge?.routes).toBe("native");
    expect(cloudflareCapabilities.edge?.bindings).toBe("unsupported");
  });

  it("uploads a Worker module, configures routes, and creates a receipt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/workers/routes")) {
        return response({ success: true, result: { id: "route-1", pattern: "example.com/*", script: "capsule-test" } });
      }
      return response({ success: true, result: { id: "script-1", entry_point: "worker.js", compatibility_date: "2026-05-12" } });
    }) as typeof fetch;
    const file = await workerFile();
    const capsule = new Capsule({
      adapter: cloudflare({
        apiToken: "cf-token",
        accountId: "acct",
        zoneId: "zone",
        fetch: fetchMock,
        compatibilityDate: "2026-05-12",
        workersDevSubdomain: "example"
      }),
      receipts: true
    });

    const deployment = await capsule.edge.deploy({
      name: "capsule-test",
      runtime: "workers",
      source: { path: file, entrypoint: "worker.js" },
      env: { MESSAGE: "hello" },
      routes: ["example.com/*"]
    });

    expect(deployment).toMatchObject({ id: "script-1", provider: "cloudflare", status: "ready", url: "https://capsule-test.example.workers.dev" });
    expect(deployment.receipt?.type).toBe("edge.deploy");
    expect(deployment.receipt?.supportLevel).toBe("native");
    expect(deployment.receipt?.policy.notes?.join(" ")).toContain("Routes were configured");
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/capsule-test");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer cf-token" });
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    const form = calls[0]?.init.body as FormData;
    expect(JSON.parse(String(form.get("metadata")))).toMatchObject({
      main_module: "worker.js",
      compatibility_date: "2026-05-12",
      bindings: [{ type: "plain_text", name: "MESSAGE", text: "hello" }]
    });
    expect(form.get("worker.js")).toBeInstanceOf(File);
    expect(calls[1]?.url).toBe("https://api.cloudflare.com/client/v4/zones/zone/workers/routes");
    expect(calls[1]?.init.method).toBe("POST");
    expect(calls[1]?.init.headers).toMatchObject({ authorization: "Bearer cf-token", "content-type": "application/json" });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ pattern: "example.com/*", script: "capsule-test" });
    expect(deployment.receipt?.metadata?.routes).toEqual([{ id: "route-1", pattern: "example.com/*", script: "capsule-test" }]);
    expect(calls.map((call) => call.url).some((url) => url.includes("/secrets"))).toBe(false);
  });

  it("uploads a Worker version without configuring routes or secrets", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ success: true, result: { id: "version-1", number: 7, metadata: { compatibility_date: "2026-05-12" }, resources: { script: { etag: "abc" } } } });
    }) as typeof fetch;
    const file = await workerFile();
    const capsule = new Capsule({
      adapter: cloudflare({
        apiToken: "cf-token",
        accountId: "acct",
        fetch: fetchMock,
        compatibilityDate: "2026-05-12"
      }),
      receipts: true
    });

    const version = await capsule.edge.version({
      name: "capsule-test",
      runtime: "workers",
      source: { path: file, entrypoint: "worker.js" },
      env: { MESSAGE: "hello" }
    });

    expect(version).toMatchObject({ id: "version-1", provider: "cloudflare", name: "capsule-test", status: "ready", metadata: { versionNumber: 7 } });
    expect(version.receipt?.type).toBe("edge.version");
    expect(version.receipt?.supportLevel).toBe("native");
    expect(version.receipt?.policy.notes?.join(" ")).toContain("does not deploy traffic by itself");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/capsule-test/versions");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer cf-token" });
    const form = calls[0]?.init.body as FormData;
    expect(JSON.parse(String(form.get("metadata")))).toMatchObject({
      main_module: "worker.js",
      compatibility_date: "2026-05-12",
      bindings: [{ type: "plain_text", name: "MESSAGE", text: "hello" }]
    });
    expect(calls.map((call) => call.url).some((url) => url.includes("/workers/routes") || url.includes("/secrets"))).toBe(false);
  });

  it("rolls back by creating a 100 percent deployment for a target Worker version", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({
        success: true,
        result: {
          id: "deployment-rollback",
          strategy: "percentage",
          versions: [{ version_id: "version-old", percentage: 100 }],
          annotations: { "workers/triggered_by": "capsule.rollback" }
        }
      });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "cf-token", accountId: "acct", fetch: fetchMock }), receipts: true });

    const rollback = await capsule.edge.rollback({
      deploymentId: "deployment-current",
      targetVersionId: "version-old",
      reason: "bad deploy",
      providerOptions: { scriptName: "capsule-test" }
    });

    expect(rollback).toMatchObject({ id: "deployment-rollback", provider: "cloudflare", deploymentId: "deployment-current", targetVersionId: "version-old", status: "ready" });
    expect(rollback.receipt?.type).toBe("edge.rollback");
    expect(rollback.receipt?.supportLevel).toBe("native");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/capsule-test/deployments");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      strategy: "percentage",
      versions: [{ version_id: "version-old", percentage: 100 }],
      annotations: { "workers/message": "bad deploy", "workers/triggered_by": "capsule.rollback" }
    });
  });

  it("can infer a rollback target from the previous Worker deployment", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (init?.method === "GET") {
        return response({
          success: true,
          result: {
            deployments: [
              { id: "deployment-current", versions: [{ version_id: "version-current", percentage: 100 }] },
              { id: "deployment-previous", versions: [{ version_id: "version-previous", percentage: 100 }] }
            ]
          }
        });
      }
      return response({ success: true, result: { id: "deployment-rollback", versions: [{ version_id: "version-previous", percentage: 100 }] } });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "cf-token", accountId: "acct", fetch: fetchMock }), receipts: true });

    const rollback = await capsule.edge.rollback({ deploymentId: "deployment-current", providerOptions: { scriptName: "capsule-test" } });

    expect(rollback.targetVersionId).toBe("version-previous");
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/capsule-test/deployments");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[1]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init.body)).versions).toEqual([{ version_id: "version-previous", percentage: 100 }]);
    expect(rollback.receipt?.providerOptions).toEqual({ scriptName: "capsule-test" });
  });

  it("requires a target version when previous Worker deployment cannot be inferred", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ success: true, result: { deployments: [{ id: "deployment-current", versions: [{ version_id: "version-current", percentage: 100 }] }] } });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "cf-token", accountId: "acct", fetch: fetchMock }) });

    await expect(capsule.edge.rollback({ deploymentId: "deployment-current", providerOptions: { scriptName: "capsule-test" } })).rejects.toThrow("requires targetVersionId");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("requires a Cloudflare Worker script name for rollback", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ success: true, result: {} });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "cf-token", accountId: "acct", fetch: fetchMock }) });

    await expect(capsule.edge.rollback({ deploymentId: "deployment-current", targetVersionId: "version-old" })).rejects.toThrow(
      "requires providerOptions.scriptName"
    );
    expect(calls).toHaveLength(0);
  });

  it("requires a zone id before uploading when routes are provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ success: true, result: {} });
    }) as typeof fetch;
    const file = await workerFile();
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "cf-token", accountId: "acct", fetch: fetchMock }) });

    await expect(capsule.edge.deploy({ name: "missing-zone", source: { path: file, entrypoint: "worker.js" }, routes: ["example.com/*"] })).rejects.toThrow(
      "requires zoneId or CLOUDFLARE_ZONE_ID"
    );
    expect(calls).toHaveLength(0);
  });

  it("keeps provider-specific and secret bindings unsupported", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ success: true, result: {} });
    }) as typeof fetch;
    const file = await workerFile();
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "cf-token", accountId: "acct", fetch: fetchMock }) });

    await expect(capsule.edge.deploy({ name: "with-bindings", source: { path: file, entrypoint: "worker.js" }, bindings: { KV: { type: "kv_namespace" } } })).rejects.toThrow(
      "does not support provider-specific bindings or secret bindings"
    );
    await expect(
      capsule.edge.version({ name: "with-secret-binding", source: { path: file, entrypoint: "worker.js" }, bindings: { API_TOKEN: { type: "secret_text", text: "secret" } } })
    ).rejects.toThrow(
      "does not support provider-specific bindings or secret bindings"
    );
    expect(calls).toHaveLength(0);
  });

  it("maps Cloudflare API errors without leaking the token", async () => {
    const file = await workerFile();
    const fetchMock = (async () => response({ success: false, errors: [{ message: "script upload failed" }] }, 400)) as typeof fetch;
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "secret-token", accountId: "acct", fetch: fetchMock }) });

    await expect(capsule.edge.deploy({ name: "bad", source: { path: file, entrypoint: "worker.js" } })).rejects.toThrow(AdapterExecutionError);
    await expect(capsule.edge.deploy({ name: "bad", source: { path: file, entrypoint: "worker.js" } })).rejects.not.toThrow("secret-token");
  });

  it("requires token and account id only when used", async () => {
    const capsule = new Capsule({ adapter: cloudflare({ apiToken: "", accountId: "" }) });
    await expect(capsule.edge.deploy({ name: "missing", source: { path: "/tmp/worker.js", entrypoint: "worker.js" } })).rejects.toThrow(
      "Cloudflare adapter requires an API token"
    );
  });
});
