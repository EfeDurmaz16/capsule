import { describe, expect, test } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { neon } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("neon adapter", () => {
  test("runs the shared adapter contract suite", async () => {
    await runAdapterContract(neon());
  });

  test("creates a branch and retrieves connection URI", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/connection_uri")) {
        return response({ uri: "postgresql://role:pass@host/db?sslmode=require" });
      }
      return response({
        branch: { id: "br_test", name: "pr-42", parent_id: "br_main", current_state: "ready" },
        endpoints: [{ id: "ep_test", type: "read_write" }]
      }, 201);
    }) as typeof fetch;

    const capsule = new Capsule({
      adapter: neon({ apiKey: "test", databaseName: "neondb", roleName: "neondb_owner", fetch: fetchMock }),
      receipts: true
    });
    const branch = await capsule.database.branch.create({ project: "project-1", parent: "br_main", name: "pr-42" });

    expect(branch.id).toBe("br_test");
    expect(branch.connectionString).toBe("postgresql://role:pass@host/db?sslmode=require");
    expect(branch.receipt?.supportLevel).toBe("native");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer test" });
    expect(calls[1]?.url).toContain("database_name=neondb");
  });

  test("deletes a branch", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response(undefined, 204);
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: neon({ apiKey: "test", fetch: fetchMock }), receipts: true });
    const deleted = await capsule.database.branch.delete({ project: "project-1", branchId: "br_test", hardDelete: true });

    expect(deleted.status).toBe("deleted");
    expect(deleted.receipt?.type).toBe("database.branch.delete");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("hard_delete=true");
  });

  test("resets a branch from a source branch", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response({ branch: { id: "br_target", name: "target", parent_id: "br_source", current_state: "ready" } });
    }) as typeof fetch;
    const capsule = new Capsule({ adapter: neon({ apiKey: "test", fetch: fetchMock }), receipts: true });
    const reset = await capsule.database.branch.reset({
      project: "project-1",
      branchId: "br_target",
      sourceBranchId: "br_source",
      pointInTime: "2026-05-13T00:00:00Z",
      preserveUnderName: "target-before-reset"
    });

    expect(reset.status).toBe("ready");
    expect(reset.receipt?.type).toBe("database.branch.reset");
    expect(reset.receipt?.supportLevel).toBe("native");
    expect(calls[0]?.url).toBe("https://console.neon.tech/api/v2/projects/project-1/branches/br_target/restore");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      source_branch_id: "br_source",
      source_timestamp: "2026-05-13T00:00:00Z",
      preserve_under_name: "target-before-reset"
    });
  });

  test("requires point-in-time input for Neon self-restore", async () => {
    const fetchMock = (async () => response({})) as typeof fetch;
    const capsule = new Capsule({ adapter: neon({ apiKey: "test", fetch: fetchMock }) });

    await expect(capsule.database.branch.reset({ project: "project-1", branchId: "br_target", sourceBranchId: "br_target" })).rejects.toThrow(
      "self-restore requires pointInTime or sourceLsn"
    );
  });
});
