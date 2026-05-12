import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule } from "@capsule/core";
import { vercel, vercelCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sourceFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-vercel-"));
  const file = join(dir, "index.js");
  await writeFile(file, "export default function handler() { return new Response('ok') }");
  return file;
}

describe("vercel adapter", () => {
  it("declares edge deploy as native", () => {
    expect(vercelCapabilities.edge?.deploy).toBe("native");
    expect(vercelCapabilities.service?.deploy).toBe("unsupported");
    expect(vercelCapabilities.edge?.rollback).toBe("unsupported");
  });

  it("satisfies the public adapter contract", async () => {
    const adapter = vercel();
    assertAdapterContract(adapter);
    await assertUnsupportedCapabilitiesReject(adapter);
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

  it("requires a token only when used", async () => {
    const capsule = new Capsule({ adapter: vercel({ token: "" }) });
    await expect(capsule.edge.deploy({ name: "missing", source: { path: await sourceFile() } })).rejects.toThrow("Vercel adapter requires a token");
  });
});
