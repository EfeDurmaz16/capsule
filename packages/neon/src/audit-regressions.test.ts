// Audit regressions for the M1 campaign (Neon). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake; no Neon API.
import { describe, expect, it } from "vitest";
import { Capsule, CleanupFailureError, PartialEffectsError, ProviderRetryableError, partialEffectsOf } from "@capsule-sdk/core";
import { NeonClient, neon } from "./index.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("M1 audit regressions: neon", () => {
  it("EDGE-04: an init branch with running operations is creating/resetting, not ready, and matches its receipt", async () => {
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
    expect(branch.receipt?.resource?.status).toBe("creating");
    expect(branch.receipt?.metadata).toMatchObject({
      currentState: "init",
      pendingState: "ready",
      operationIds: ["op_audit"],
      pendingOperationIds: ["op_audit"]
    });
    expect(reset.receipt?.resource?.status).toBe("resetting");
    expect(reset.metadata).toMatchObject({ currentState: "init", pendingState: "ready", pendingOperationIds: ["op_audit"] });
  });

  it("EDGE-04: a failed state or failed operation stays failed; a settled ready branch is ready", async () => {
    const reply = (body: unknown) => new Capsule({ adapter: neon({ apiKey: "fake", fetch: async () => json(body) }), receipts: true });
    const failedOp = reply({ branch: { id: "br", name: "b", current_state: "init" }, operations: [{ id: "op1", status: "error" }] });
    const failedOpBranch = await failedOp.database.branch.create({ project: "p", name: "b" });
    expect(failedOpBranch.status).toBe("failed");
    expect(failedOpBranch.receipt?.metadata).toMatchObject({ failedOperationIds: ["op1"] });
    const failedState = reply({ branch: { id: "br", name: "b", current_state: "failed" } });
    expect((await failedState.database.branch.reset({ project: "p", branchId: "br", sourceBranchId: "src" })).status).toBe("failed");
    const settled = reply({ branch: { id: "br", name: "b", current_state: "ready" }, operations: [{ id: "op1", status: "finished" }] });
    expect((await settled.database.branch.create({ project: "p", name: "b" })).status).toBe("ready");
    const missingState = reply({ branch: { id: "br", name: "b" } });
    expect((await missingState.database.branch.create({ project: "p", name: "b" })).status).toBe("creating");
  });

  it("EDGE-06b: a failed URI retrieval plus failed branch cleanup keeps the branch ID, primary error and cleanup outcome", async () => {
    const capsule = new Capsule({
      adapter: neon({
        apiKey: "fake",
        databaseName: "db",
        roleName: "owner",
        fetch: async (url, init) => {
          if (String(url).includes("/connection_uri")) return json({ message: "uri failed" }, 500);
          if (init?.method === "DELETE") return json({ message: "delete failed" }, 500);
          return json({ branch: { id: "br_created", name: "audit", current_state: "ready" } }, 201);
        }
      })
    });
    const error = await capsule.database.branch.create({ project: "p_audit", name: "audit" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CleanupFailureError);
    expect((error as Error).message).toContain("br_created");
    expect((error as CleanupFailureError).cause).toBeInstanceOf(ProviderRetryableError);
    expect(((error as CleanupFailureError).cause as Error).message).toBe("uri failed");
    const effects = partialEffectsOf(error);
    expect(effects).toMatchObject({
      operation: "database.branchCreate",
      outcome: "failed",
      resources: [{ provider: "neon", kind: "branch", nativeId: "br_created", scope: { project: "p_audit" } }],
      cleanup: { status: "failed", residual: [{ nativeId: "br_created" }] }
    });
    expect((effects?.cleanup.error as Error).message).toBe("delete failed");
    expect((effects?.primaryError as Error).message).toBe("uri failed");
  });

  it("EDGE-06b: an unconfirmed branch cleanup is reported as unknown, not as cleaned up", async () => {
    const capsule = new Capsule({
      adapter: neon({
        apiKey: "fake",
        databaseName: "db",
        roleName: "owner",
        requestTimeoutMs: 50,
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          if (String(url).includes("/connection_uri")) return json({ message: "uri failed" }, 500);
          if (init?.method === "DELETE") return await new Promise<Response>(() => undefined);
          return json({ branch: { id: "br_created", name: "audit", current_state: "ready" } }, 201);
        }) as typeof fetch
      })
    });
    const error = await capsule.database.branch.create({ project: "p_audit", name: "audit" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialEffectsError);
    expect(partialEffectsOf(error)?.cleanup).toMatchObject({ status: "unknown", residual: [{ nativeId: "br_created" }] });
  });

  it("EDGE-05d: an HTML 503 keeps the HTTP status and retry category instead of a SyntaxError", async () => {
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
