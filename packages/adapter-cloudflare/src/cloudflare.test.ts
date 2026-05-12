import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule } from "@capsule/core";
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
  it("declares edge deploy as native", () => {
    expect(cloudflareCapabilities.edge?.deploy).toBe("native");
    expect(cloudflareCapabilities.edge?.routes).toBe("unsupported");
  });

  it("uploads a Worker module and creates a receipt", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ success: true, result: { id: "script-1", entry_point: "worker.js", compatibility_date: "2026-05-12" } });
    }) as typeof fetch;
    const file = await workerFile();
    const capsule = new Capsule({
      adapter: cloudflare({
        apiToken: "cf-token",
        accountId: "acct",
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
    expect(deployment.receipt?.policy.notes?.join(" ")).toContain("Routes were recorded");
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
