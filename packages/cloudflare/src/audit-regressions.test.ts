// Audit regressions for the M1 campaign (Cloudflare). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake; no Cloudflare API.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Capsule, ProviderRetryableError } from "@capsule-sdk/core";
import { CloudflareClient, cloudflare } from "./index.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Collects every message, cause and enumerable property reachable from an error, for provenance checks
// that must not depend on one specific error shape.
function errorText(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || value === undefined || seen.has(value)) return "";
  if (typeof value !== "object") return String(value);
  seen.add(value);
  const parts: string[] = [];
  if (value instanceof Error) parts.push(value.message, errorText((value as { cause?: unknown }).cause, seen));
  for (const child of Object.values(value)) parts.push(errorText(child, seen));
  return parts.join(" ");
}

describe("M1 audit regressions: cloudflare", () => {
  it.fails("EDGE-07: implicit rollback to a split deployment requires an explicit target", async () => {
    const posts: unknown[] = [];
    const capsule = new Capsule({
      adapter: cloudflare({
        apiToken: "fake",
        accountId: "acct_audit",
        fetch: async (_url, init) => {
          if (init?.method === "GET") {
            return json({
              success: true,
              result: {
                deployments: [
                  { id: "d_current", versions: [{ version_id: "v_current", percentage: 100 }] },
                  {
                    id: "d_prev",
                    versions: [
                      { version_id: "v_a", percentage: 10 },
                      { version_id: "v_b", percentage: 90 }
                    ]
                  }
                ]
              }
            });
          }
          posts.push(JSON.parse(String(init?.body)));
          return json({ success: true, result: { id: "d_rollback" } });
        }
      })
    });
    const outcome = await capsule.edge.rollback({ deploymentId: "d_current", providerOptions: { scriptName: "audit" } }).then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
    expect(posts).toHaveLength(0);
  });

  it.fails("EDGE-06a: a route failure after upload carries Worker/route identities and the cleanup failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-edge06-"));
    try {
      const source = join(dir, "worker.js");
      await writeFile(source, "export default { fetch() { return new Response('ok'); } }");
      const capsule = new Capsule({
        adapter: cloudflare({
          apiToken: "fake",
          accountId: "acct_audit",
          zoneId: "zone_audit",
          fetch: async (_url, init) => {
            if (init?.method === "PUT") return json({ success: true, result: { id: "script_audit" } });
            if (init?.method === "DELETE") return json({ success: false, errors: [{ message: "cleanup failed" }] }, 500);
            if (JSON.parse(String(init?.body)).pattern === "ok.example/*") {
              return json({ success: true, result: { id: "route_audit", pattern: "ok.example/*", script: "worker_audit" } });
            }
            return json({ success: false, errors: [{ message: "route create failed" }] }, 400);
          }
        })
      });
      const error = await capsule.edge.deploy({ name: "worker_audit", source: { path: source }, routes: ["ok.example/*", "bad.example/*"] }).then(
        () => undefined,
        (caught: unknown) => caught
      );
      const text = errorText(error);
      expect(text).toContain("route create failed");
      expect(text).toContain("cleanup failed");
      expect(text).toContain("route_audit");
      expect(text).toContain("worker_audit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("EDGE-05a: an HTML 503 keeps the HTTP status and retry category instead of a SyntaxError", async () => {
    const client = new CloudflareClient({
      apiToken: "fake",
      accountId: "acct_audit",
      fetch: async () => new Response("<html>maintenance</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "5" } })
    });
    const error = await client.listWorkerDeployments("worker_audit").then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ProviderRetryableError);
  });

  it("EDGE-05a guard: a malformed successful JSON body is still rejected", async () => {
    const client = new CloudflareClient({
      apiToken: "fake",
      accountId: "acct_audit",
      fetch: async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(client.listWorkerDeployments("worker_audit")).rejects.toThrow();
  });
});
