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
