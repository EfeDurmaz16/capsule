import { describe, expect, it } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule/core";
import { liveResourceMetadata, liveTest, providerLiveTestGate } from "@capsule/test-utils";
import { e2b } from "./e2b-adapter.js";

const e2bLiveGate = providerLiveTestGate("e2b");

describe("e2b live adapter", () => {
  liveTest(it, "creates a sandbox, executes commands, handles files, and destroys the sandbox", e2bLiveGate, async () => {
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: e2b({ apiKey: process.env.E2B_API_KEY }),
      policy: {
        limits: { timeoutMs: 30_000 },
        network: { mode: "none" }
      },
      receipts: true,
      receiptStore: store
    });

    const liveResource = liveResourceMetadata({ provider: "e2b", resource: "sandbox" });
    const sandbox = await capsule.sandbox.create({
      name: liveResource.name,
      cwd: "/tmp",
      timeoutMs: 30_000,
      labels: liveResource.labels
    });

    const testDir = `/tmp/${liveResource.name}`;
    const testFile = `${testDir}/message.txt`;

    try {
      const execResult = await sandbox.exec({ command: ["sh", "-lc", `mkdir -p ${testDir} && printf capsule-live`] });
      expect(execResult.exitCode).toBe(0);
      expect(execResult.stdout).toBe("capsule-live");

      await sandbox.writeFile(testFile, "hello from capsule");

      const file = await sandbox.readFile(testFile);
      expect(new TextDecoder().decode(file)).toBe("hello from capsule");

      const entries = await sandbox.listFiles(testDir);
      expect(entries).toContainEqual(expect.objectContaining({ name: "message.txt", type: "file" }));
    } finally {
      await sandbox.destroy();
    }

    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.destroy"]);
    for (const receipt of store.receipts) {
      expect(receipt.metadata).toMatchObject({ runtimeVersion: process.version, adapterVersion: "0.1.1" });
    }
  });
});
