// GAP-06 (CLI half) and COMP-01: the preview cleanup file joins resources to cleanup actions by graph-local
// ref, records that ref, and is validated field by field on destroy instead of cast. Only offline mock
// adapters are used; no provider API is contacted.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./index.js";

interface CleanupFile {
  previewId: string;
  actions: Array<{ actionId: string; resourceRef?: string; resourceId: string; spec: Record<string, unknown>; idempotencyKey?: string }>;
  resources: Array<{
    ref?: string;
    id: string;
    cleanupActionId?: string;
    cleanup?: { actionId?: string; spec: Record<string, unknown> };
  }>;
}

// Two Neon branches in different projects with the same name get the same native branch id in the
// mock (neon_branch_<name>), which is the collision a native-id join cannot tell apart.
const collidingConfig = {
  name: "pr-71",
  requireRealProviders: true,
  allowMockProviders: true,
  databases: [
    { adapter: "mock-neon", spec: { project: "app-a", name: "pr-71-db" } },
    { adapter: "mock-neon", spec: { project: "app-b", name: "pr-71-db" } }
  ]
};

let root: string;
let logs: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capsule-preview-file-"));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    logs.push(String(value));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await rm(root, { recursive: true, force: true });
});

async function createCleanupFile(): Promise<{ path: string; file: CleanupFile }> {
  const configFile = join(root, "preview.json");
  const cleanupFile = join(root, "cleanup.json");
  await writeFile(configFile, JSON.stringify(collidingConfig), "utf8");
  await main(["preview", "create", "--config-file", configFile, "--cleanup-file", cleanupFile]);
  return { path: cleanupFile, file: JSON.parse(await readFile(cleanupFile, "utf8")) as CleanupFile };
}

async function rewrite(path: string, file: CleanupFile): Promise<void> {
  await writeFile(path, JSON.stringify(file), "utf8");
}

describe("preview cleanup file (GAP-06 CLI half, COMP-01)", () => {
  it("attaches each resource's own action when native ids collide across projects, and records the ref", async () => {
    const { file } = await createCleanupFile();

    expect(file.resources.map((resource) => resource.id)).toEqual(["neon_branch_pr-71-db", "neon_branch_pr-71-db"]);
    const projects = file.resources.map((resource) => resource.cleanup?.spec.project);
    expect(projects).toEqual(["app-a", "app-b"]);
    for (const resource of file.resources) {
      expect(resource.ref).toEqual(expect.any(String));
      const action = file.actions.find((entry) => entry.resourceRef === resource.ref);
      expect(action).toBeDefined();
      expect(resource.cleanupActionId).toBe(action?.actionId);
      expect(resource.cleanup?.spec).toEqual(action?.spec);
    }
    expect(new Set(file.resources.map((resource) => resource.cleanupActionId)).size).toBe(2);
  });

  it("destroys both colliding resources from the recorded plan", async () => {
    const { path } = await createCleanupFile();
    logs.length = 0;

    await main(["preview", "destroy", "--cleanup-file", path]);
    const report = JSON.parse(logs[0] ?? "{}") as { status: string; summary: { cleaned: number; leaked: number } };
    expect(report.status).toBe("cleaned");
    expect(report.summary).toMatchObject({ cleaned: 2, leaked: 0 });
  });

  it("rejects a plan action whose spec was redirected to another project before any delete", async () => {
    const { path, file } = await createCleanupFile();
    const target = file.actions.find((action) => action.spec.project === "app-a");
    expect(target).toBeDefined();
    target!.spec = { ...target!.spec, project: "app-b" };
    await rewrite(path, file);
    logs.length = 0;

    await expect(main(["preview", "destroy", "--cleanup-file", path])).rejects.toThrow(/does not match that resource/);
    expect(logs).toEqual([]);
  });

  it("rejects a plan whose previewId does not belong to the recorded preview", async () => {
    const { path, file } = await createCleanupFile();
    file.previewId = "preview_foreign";
    await rewrite(path, file);

    await expect(main(["preview", "destroy", "--cleanup-file", path])).rejects.toThrow(/belongs to preview preview_foreign/);
  });

  it("rejects malformed actions instead of casting them", async () => {
    const { path, file } = await createCleanupFile();
    delete file.actions[0]!.idempotencyKey;
    await rewrite(path, file);

    await expect(main(["preview", "destroy", "--cleanup-file", path])).rejects.toThrow(/actions\[0\]\.idempotencyKey must be/);

    const second = JSON.parse(await readFile(path, "utf8")) as CleanupFile & { actions: Array<Record<string, unknown>> };
    second.actions[0]!.idempotencyKey = "key";
    second.actions[0]!.kind = "bucket";
    await writeFile(path, JSON.stringify(second), "utf8");
    await expect(main(["preview", "destroy", "--cleanup-file", path])).rejects.toThrow(/actions\[0\]\.kind must be one of/);
  });

  it("applies --hard-delete to the bound plan action", async () => {
    const { path } = await createCleanupFile();
    logs.length = 0;

    await main(["preview", "destroy", "--cleanup-file", path, "--hard-delete"]);
    const report = JSON.parse(logs[0] ?? "{}") as { receipts: Array<{ type: string; metadata?: Record<string, unknown> }> };
    const deletes = report.receipts.filter((receipt) => receipt.type === "database.branch.delete");
    expect(deletes).toHaveLength(2);
    for (const receipt of deletes) {
      expect(JSON.stringify(receipt.metadata)).toContain('"hardDelete":true');
    }
  });
});

// GAP-06 (CLI half): a create that fails part-way still records how to remove what it left behind.
// The second database uses the real neon adapter against a stubbed fetch that answers with Neon v2
// response shapes: the branch is created with a running operation, connection_uri returns 500 and the
// compensating DELETE returns 423 (Neon refuses changes while operations run). No network is contacted
// and the API key is a fixture value.
describe("preview create failing part-way (GAP-06 CLI half)", () => {
  interface NeonCall {
    method: string;
    url: string;
  }

  const partialConfig = {
    name: "pr-72",
    allowMockProviders: true,
    databases: [
      { adapter: "mock-neon", spec: { project: "app", name: "pr-72-db" } },
      { adapter: "neon", options: { database: "app", role: "app" }, spec: { project: "p1", name: "pr-72-neon" } }
    ]
  };

  async function withNeon<T>(deleteStatus: number, run: (calls: NeonCall[]) => Promise<T>): Promise<T> {
    const calls: NeonCall[] = [];
    const previousKey = process.env.NEON_API_KEY;
    process.env.NEON_API_KEY = "fixture-neon-key";
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      calls.push({ method, url });
      if (method === "POST" && url.endsWith("/projects/p1/branches")) {
        return json(201, {
          branch: { id: "br-leak-1", name: "pr-72-neon", parent_id: "br-main", current_state: "init" },
          operations: [{ id: "op-1", action: "create_branch", status: "running", branch_id: "br-leak-1" }]
        });
      }
      if (url.includes("/connection_uri")) {
        return json(500, { message: "internal error" });
      }
      if (method === "DELETE") {
        return deleteStatus === 200
          ? json(200, { branch: { id: "br-leak-1", name: "pr-72-neon", parent_id: "br-main", current_state: "ready" }, operations: [] })
          : json(deleteStatus, { message: "project already has running operations" });
      }
      return json(404, { message: "not found" });
    });
    try {
      return await run(calls);
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.NEON_API_KEY;
      else process.env.NEON_API_KEY = previousKey;
    }
  }

  it("writes the created resources and the failed step's residual to --cleanup-file, and destroy removes them", async () => {
    const configFile = join(root, "preview.json");
    const cleanupFile = join(root, "out", "cleanup.json");
    await writeFile(configFile, JSON.stringify(partialConfig), "utf8");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((value: unknown) => {
      errors.push(String(value));
    });

    await withNeon(423, async (calls) => {
      await expect(main(["preview", "create", "--config-file", configFile, "--cleanup-file", cleanupFile])).rejects.toThrow(/Preview environment creation failed/);
      expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    });
    expect(errors.join("\n")).toContain(cleanupFile);

    const file = JSON.parse(await readFile(cleanupFile, "utf8")) as {
      actions: unknown[];
      resources: Array<{ id: string; residual?: { locator: { nativeId: string; scope?: Record<string, string> } }; cleanup?: { adapter: string } }>;
    };
    expect(file.resources.map((resource) => [resource.id, resource.cleanup?.adapter, resource.residual?.locator.scope])).toEqual([
      ["neon_branch_pr-72-db", "mock-neon", undefined],
      ["br-leak-1", "neon", { project: "p1" }]
    ]);
    expect(file.actions).toHaveLength(2);

    await withNeon(200, async (calls) => {
      await main(["preview", "destroy", "--cleanup-file", cleanupFile, "--json"]);
      expect(calls).toEqual([{ method: "DELETE", url: "https://console.neon.tech/api/v2/projects/p1/branches/br-leak-1" }]);
    });
    const report = JSON.parse(logs.at(-1) ?? "{}") as { status: string; summary: { cleaned: number; leaked: number } };
    expect(report.status).toBe("cleaned");
    expect(report.summary).toMatchObject({ cleaned: 2, leaked: 0 });
  });

  it("prints the recovery bindings to stderr when no --cleanup-file was given", async () => {
    const configFile = join(root, "preview.json");
    await writeFile(configFile, JSON.stringify(partialConfig), "utf8");
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((value: unknown) => {
      errors.push(String(value));
    });
    await withNeon(423, async () => {
      await expect(main(["preview", "create", "--config-file", configFile])).rejects.toThrow(/Preview environment creation failed/);
    });
    const printed = JSON.parse(errors.at(-1) ?? "{}") as CleanupFile;
    expect(printed.resources.map((resource) => resource.id)).toEqual(["neon_branch_pr-72-db", "br-leak-1"]);
  });

  it("refuses a policy denial of a later child before creating any earlier child", async () => {
    const configFile = join(root, "preview.json");
    const cleanupFile = join(root, "cleanup.json");
    const policyFile = join(root, "policy.json");
    await writeFile(
      configFile,
      JSON.stringify({
        name: "pr-73",
        allowMockProviders: true,
        databases: [{ adapter: "mock-neon", spec: { project: "app", name: "audit-db" } }],
        services: [{ adapter: "mock-cloud-run", spec: { name: "web", image: "img", env: { API_TOKEN: "fixture" } } }]
      }),
      "utf8"
    );
    await writeFile(policyFile, JSON.stringify({ secrets: { allowed: [] } }), "utf8");
    const error = await main(["preview", "create", "--config-file", configFile, "--cleanup-file", cleanupFile, "--policy-file", policyFile]).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect((error as Error).message).toMatch(/refused before any provider call/);
    expect(((error as Error).cause as Error).message).toMatch(/API_TOKEN/);
    await expect(readFile(cleanupFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
