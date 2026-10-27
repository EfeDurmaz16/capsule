// Audit regressions for the M1 campaign (Neon). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake; no Neon API.
import { describe, expect, it } from "vitest";
import { Capsule, ProviderRetryableError } from "@capsule-sdk/core";
import { NeonClient, neon } from "./index.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("M1 audit regressions: neon", () => {
  it.fails("EDGE-04: an init branch with running operations is creating/resetting, not ready, and matches its receipt", async () => {
    const capsule = new Capsule({
      adapter: neon({
        apiKey: "fake",
        fetch: async () =>
          json({
            branch: { id: "br_audit", name: "audit", current_state: "init", pending_state: "ready" },
            operations: [{ id: "op_audit", status: "running" }]
          })
      }),
      receipts: true
    });
    const branch = await capsule.database.branch.create({ project: "p_audit", name: "audit" });
    const reset = await capsule.database.branch.reset({ project: "p_audit", branchId: "br_audit", sourceBranchId: "br_source" });
    expect(branch.status).toBe("creating");
    expect(reset.status).toBe("resetting");
  });

  it.fails("EDGE-05d: an HTML 503 keeps the HTTP status and retry category instead of a SyntaxError", async () => {
    const client = new NeonClient({
      apiKey: "fake",
      fetch: async () => new Response("<html>maintenance</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "5" } })
    });
    const error = await client.request({ path: "/anything" }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ProviderRetryableError);
  });

  it("EDGE-05d guard: a malformed successful JSON body is still rejected", async () => {
    const client = new NeonClient({
      apiKey: "fake",
      fetch: async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(client.request({ path: "/anything" })).rejects.toThrow();
  });
});
