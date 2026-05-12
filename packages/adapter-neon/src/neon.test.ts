import { describe, expect, test } from "vitest";
import { assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule } from "@capsule/core";
import { neon, neonCapabilities } from "./index.js";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("neon adapter", () => {
  test("declares database branch capabilities as native", () => {
    expect(neonCapabilities.database?.branchCreate).toBe("native");
    expect(neonCapabilities.database?.branchDelete).toBe("native");
    expect(neonCapabilities.preview?.create).toBe("unsupported");
  });

  test("satisfies the public adapter contract", async () => {
    const adapter = neon();
    assertAdapterContract(adapter);
    await assertUnsupportedCapabilitiesReject(adapter);
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
});
