import { describe, expect, it } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule/core";
import { e2b } from "./e2b-adapter.js";

const liveTestsEnabled = process.env.CAPSULE_LIVE_TESTS === "1";
const e2bApiKey = process.env.E2B_API_KEY;
const runLiveE2B = liveTestsEnabled && Boolean(e2bApiKey);

describe("e2b live adapter", () => {
  it.skipIf(!runLiveE2B)("creates a sandbox, executes commands, handles files, and destroys the sandbox", async () => {
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: e2b({ apiKey: e2bApiKey }),
      policy: {
        limits: { timeoutMs: 30_000 },
        network: { mode: "none" }
      },
      receipts: true,
      receiptStore: store
    });

    const sandbox = await capsule.sandbox.create({
      name: "capsule-e2b-live-test",
      cwd: "/tmp",
      timeoutMs: 30_000,
      labels: { capsule_test: "e2b-live" }
    });

    const testDir = `/tmp/capsule-e2b-live-${Date.now()}`;
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
  });
});
