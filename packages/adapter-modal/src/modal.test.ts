import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, MemoryReceiptStore } from "@capsule/core";
import { modal, modalCapabilities } from "./index.js";

describe("modal adapter", () => {
  it("declares sandbox support with honest file list gap", () => {
    expect(modalCapabilities.sandbox?.create).toBe("native");
    expect(modalCapabilities.sandbox?.fileList).toBe("unsupported");
  });

  it("creates a sandbox and maps exec/read/write/destroy", async () => {
    const files = new Map<string, Uint8Array>();
    const created: any[] = [];
    const sandbox = {
      sandboxId: "sb-1",
      exec: async (command: string[]) => ({
        wait: async () => 0,
        stdout: { readText: async () => command.join(" ") },
        stderr: { readText: async () => "" }
      }),
      open: async (path: string) => ({
        write: async (data: Uint8Array) => {
          files.set(path, data);
        },
        read: async () => files.get(path) ?? new Uint8Array(),
        flush: async () => undefined,
        close: async () => undefined
      }),
      terminate: async () => undefined
    };
    const client = {
      apps: { fromName: async () => ({ appId: "app-1" }) },
      images: { fromRegistry: (tag: string) => ({ tag }) },
      sandboxes: {
        create: async (...args: any[]) => {
          created.push(args);
          return sandbox;
        }
      }
    };
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client, appName: "capsule-test" }), policy: { network: { mode: "none" } }, receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({ image: "node:22", name: "box" });
    await box.writeFile("/workspace/index.js", "console.log('hi')");
    const data = await box.readFile("/workspace/index.js");
    const result = await box.exec({ command: ["node", "/workspace/index.js"] });
    await expect(box.listFiles("/workspace")).rejects.toThrow(AdapterExecutionError);
    await box.destroy();

    expect(created[0][2]).toMatchObject({ name: "box", blockNetwork: true });
    expect(new TextDecoder().decode(data)).toBe("console.log('hi')");
    expect(result.stdout).toContain("node");
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.destroy"]);
  });
});
