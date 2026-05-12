import { describe, expect, it } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule/core";
import { daytona, daytonaCapabilities } from "./index.js";

describe("daytona adapter", () => {
  it("declares sandbox capabilities as native", () => {
    expect(daytonaCapabilities.sandbox?.create).toBe("native");
    expect(daytonaCapabilities.sandbox?.exec).toBe("native");
  });

  it("creates a sandbox and maps exec/files/destroy", async () => {
    const createdWith: any[] = [];
    const files = new Map<string, Buffer>();
    const sandbox = {
      id: "sandbox-1",
      name: "box",
      state: "started",
      createdAt: "2026-05-12T00:00:00.000Z",
      process: {
        executeCommand: async (command: string) => ({ exitCode: 0, result: `ran ${command}` })
      },
      fs: {
        uploadFile: async (data: Buffer, path: string) => {
          files.set(path, data);
        },
        downloadFile: async (path: string) => files.get(path) ?? Buffer.from(""),
        listFiles: async (path: string) => [{ name: "index.js", path: `${path}/index.js`, type: "file", size: 20 }]
      },
      delete: async () => undefined
    };
    const client = {
      create: async (...args: any[]) => {
        createdWith.push(...args);
        return sandbox;
      }
    };
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: daytona({ client, ephemeral: true }),
      policy: { network: { mode: "none" } },
      receipts: true,
      receiptStore: store
    });

    const box = await capsule.sandbox.create({ image: "node:22", name: "box", env: { NODE_ENV: "test" } });
    await box.writeFile("/workspace/index.js", "console.log('hi')");
    const data = await box.readFile("/workspace/index.js");
    const entries = await box.listFiles("/workspace");
    const result = await box.exec({ command: ["node", "/workspace/index.js"] });
    await box.destroy();

    expect(createdWith[0]).toMatchObject({ image: "node:22", name: "box", networkBlockAll: true, ephemeral: true });
    expect(new TextDecoder().decode(data)).toBe("console.log('hi')");
    expect(entries[0]).toMatchObject({ name: "index.js", type: "file" });
    expect(result.stdout).toContain("node");
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.destroy"]);
  });
});
