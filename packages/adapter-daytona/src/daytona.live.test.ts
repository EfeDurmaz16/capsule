import { describe, expect, test } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule-sdk/core";
import { liveResourceMetadata, liveTest, providerLiveTestGate } from "@capsule-sdk/test-utils";
import { daytona } from "./daytona-adapter.js";

const daytonaLiveGate = providerLiveTestGate("daytona");

function runLiveDaytona(name: string, fn: () => unknown | Promise<unknown>, timeout?: number): void {
  liveTest(test, name, daytonaLiveGate, fn, timeout);
}

describe("daytona live adapter", () => {
  runLiveDaytona(
    "creates a sandbox, executes commands, handles files, and destroys the sandbox",
    async () => {
      const store = new MemoryReceiptStore();
      const capsule = new Capsule({
        adapter: daytona({ apiKey: process.env.DAYTONA_API_KEY, ephemeral: true, autoStopIntervalMinutes: 10 }),
        policy: {
          limits: { timeoutMs: 60_000 },
          network: { mode: "none" }
        },
        receipts: true,
        receiptStore: store
      });

      const liveResource = liveResourceMetadata({ provider: "daytona", resource: "sandbox" });
      const sandbox = await capsule.sandbox.create({
        name: liveResource.name,
        image: "node:22",
        timeoutMs: 60_000,
        labels: liveResource.labels
      });

      const testDir = `/workspace/${liveResource.name}`;
      const testFile = `${testDir}/message.txt`;

      try {
        const mkdirResult = await sandbox.exec({ command: ["sh", "-lc", `mkdir -p ${testDir} && printf capsule-daytona-live`] });
        expect(mkdirResult.exitCode).toBe(0);
        expect(mkdirResult.stdout).toContain("capsule-daytona-live");

        await sandbox.writeFile(testFile, "hello from capsule daytona");

        const file = await sandbox.readFile(testFile);
        expect(new TextDecoder().decode(file)).toBe("hello from capsule daytona");

        const entries = await sandbox.listFiles(testDir);
        expect(entries).toContainEqual(expect.objectContaining({ name: "message.txt", type: "file" }));

        const execResult = await sandbox.exec({
          command: ["sh", "-lc", `cat ${testFile}`],
          timeoutMs: 30_000
        });
        expect(execResult.exitCode).toBe(0);
        expect(execResult.stdout).toContain("hello from capsule daytona");
      } finally {
        // Best-effort cleanup: if an assertion or provider operation fails after create,
        // still ask Daytona to delete the sandbox so live test runs do not leak workspaces.
        await sandbox.destroy();
      }

      expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.exec", "sandbox.destroy"]);
      for (const receipt of store.receipts) {
        expect(receipt.metadata).toMatchObject({ runtimeVersion: process.version, adapterVersion: "0.1.1" });
      }
    },
    120_000
  );
});
