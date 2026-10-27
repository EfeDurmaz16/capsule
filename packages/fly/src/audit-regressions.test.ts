// Audit regressions for the M1 campaign (Fly). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake; no Machines API.
import { describe, expect, it } from "vitest";
import { Capsule, ProviderRetryableError } from "@capsule-sdk/core";
import { FlyClient, fly } from "./index.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("M1 audit regressions: fly", () => {
  it("EDGE-01: job.run sends config.auto_destroy, not a top-level auto_destroy", async () => {
    let body: { auto_destroy?: unknown; config?: { auto_destroy?: unknown } } = {};
    const capsule = new Capsule({
      adapter: fly({
        appName: "audit",
        apiToken: "fake",
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return json({ id: "m_audit", state: "created" });
        }
      }),
      receipts: true
    });
    await capsule.job.run({ image: "node:22", command: ["node", "script.js"] });
    expect(body.config?.auto_destroy).toBe(true);
    expect(body.auto_destroy).toBeUndefined();
  });

  it.fails("EDGE-08: the native creating state maps to creating, not failed", async () => {
    const capsule = new Capsule({ adapter: fly({ appName: "audit", apiToken: "fake", fetch: async () => json({ id: "m_audit", state: "creating" }) }) });
    expect((await capsule.machine.status({ id: "m_audit" })).status).toBe("creating");
  });

  it.fails("EDGE-05c: an HTML 503 keeps the HTTP status and retry category instead of a SyntaxError", async () => {
    const client = new FlyClient({
      apiToken: "fake",
      fetch: async () => new Response("<html>maintenance</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "5" } })
    });
    const error = await client.request({ path: "/anything" }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ProviderRetryableError);
  });

  it("EDGE-05c guard: a malformed successful JSON body is still rejected", async () => {
    const client = new FlyClient({
      apiToken: "fake",
      fetch: async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(client.request({ path: "/anything" })).rejects.toThrow();
  });
});
