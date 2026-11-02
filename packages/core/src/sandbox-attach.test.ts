import { describe, expect, test } from "vitest";
import { Capsule, MemoryReceiptStore, PolicyViolationError, UnsupportedCapabilityError, type CapsuleAdapter, type Sandbox } from "./index.js";

const capabilities = {
  sandbox: { create: "native", exec: "native", fileRead: "native", fileWrite: "native", fileList: "native", destroy: "native" }
} as const;

function adapterWithAttach(calls: string[], withAttach = true): CapsuleAdapter {
  const sandbox = (id: string): Sandbox => ({
    handle: { id, provider: "fake", createdAt: "2026-10-27T00:00:00.000Z" },
    exec: async () => {
      calls.push(`exec:${id}`);
      return { exitCode: 0, stdout: "ok\n", stderr: "", logs: [], artifacts: [] };
    },
    writeFile: async () => undefined,
    readFile: async () => new Uint8Array(),
    listFiles: async () => [],
    destroy: async () => {
      calls.push(`destroy:${id}`);
    }
  });
  return {
    name: "fake",
    provider: "fake",
    capabilities,
    sandbox: {
      create: async () => {
        calls.push("create");
        return sandbox("created");
      },
      ...(withAttach
        ? {
            attach: async (spec: { id: string }) => {
              calls.push(`attach:${spec.id}`);
              return sandbox(spec.id);
            }
          }
        : {})
    }
  };
}

describe("Capsule.sandbox.attach", () => {
  test("fails before any provider call when the adapter cannot attach", async () => {
    const calls: string[] = [];
    const capsule = new Capsule({ adapter: adapterWithAttach(calls, false) });
    await expect(capsule.sandbox.attach({ id: "sb-1" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    expect(calls).toEqual([]);
  });

  test("writes no receipt itself and governs later operations like a created sandbox", async () => {
    const calls: string[] = [];
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: adapterWithAttach(calls), receipts: true, receiptStore: store, receiptPersistence: "required" });
    const sandbox = await capsule.sandbox.attach({ id: "sb-1" });
    expect(store.receipts).toEqual([]);
    const result = await sandbox.exec({ command: ["echo", "ok"] });
    expect(result.stdout).toBe("ok\n");
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.exec"]);
    expect(calls).toEqual(["attach:sb-1", "exec:sb-1"]);
  });

  test("has no captured create grant: destroy needs its own fresh approval for that sandbox", async () => {
    const calls: string[] = [];
    const capsule = new Capsule({ adapter: adapterWithAttach(calls), policy: { approvals: { required: true, reason: "destroy" } } });
    const sandbox = await capsule.sandbox.attach({ id: "sb-1" });
    await expect(sandbox.destroy()).rejects.toBeInstanceOf(PolicyViolationError);
    await expect(sandbox.destroy({ approval: { approved: true, id: "create-only", capabilities: ["sandbox.create"] } })).rejects.toBeInstanceOf(
      PolicyViolationError
    );
    await expect(
      sandbox.destroy({
        approval: { approved: true, id: "other", capabilities: ["sandbox.destroy"], resources: [{ type: "sandbox", id: "sb-2", provider: "fake" }] }
      })
    ).rejects.toBeInstanceOf(PolicyViolationError);
    expect(calls).toEqual(["attach:sb-1"]);
    await sandbox.destroy({
      approval: { approved: true, id: "fresh", capabilities: ["sandbox.destroy"], resources: [{ type: "sandbox", id: "sb-1", provider: "fake" }] }
    });
    expect(calls).toEqual(["attach:sb-1", "destroy:sb-1"]);
  });
});
