import { describe, expect, test } from "vitest";
import { AdapterExecutionError, Capsule, MemoryReceiptStore } from "@capsule/core";
import { liveTest, providerLiveTestGate } from "@capsule/test-utils";
import { modal } from "./modal-adapter.js";

const modalLiveGate = providerLiveTestGate("modal");

function uniqueName(label: string): string {
  return `capsule-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("modal live adapter", () => {
  liveTest(
    test,
    "covers sandbox create, exec, file read/write, unsupported file list, and destroy",
    modalLiveGate,
    async () => {
      const store = new MemoryReceiptStore();
      const capsule = new Capsule({
        adapter: modal({
          appName: process.env.MODAL_APP_NAME ?? "capsule-live-test",
          defaultImage: process.env.MODAL_IMAGE ?? "debian:bookworm-slim",
          environment: process.env.MODAL_ENVIRONMENT,
          tokenId: process.env.MODAL_TOKEN_ID,
          tokenSecret: process.env.MODAL_TOKEN_SECRET
        }),
        policy: {
          limits: { timeoutMs: 30_000 },
          network: { mode: "none" }
        },
        receipts: true,
        receiptStore: store
      });

      const sandbox = await capsule.sandbox.create({
        image: process.env.MODAL_IMAGE ?? "debian:bookworm-slim",
        name: uniqueName("modal-live"),
        cwd: "/tmp",
        timeoutMs: 30_000
      });
      const testDir = `/tmp/capsule-modal-live-${Date.now()}`;
      const testFile = `${testDir}/message.txt`;

      try {
        const setup = await sandbox.exec({ command: ["sh", "-lc", `mkdir -p ${testDir} && printf capsule-modal-live`] });
        expect(setup.exitCode).toBe(0);
        expect(setup.stdout).toBe("capsule-modal-live");

        await sandbox.writeFile(testFile, "hello from modal sandbox");

        const file = await sandbox.readFile(testFile);
        expect(new TextDecoder().decode(file)).toBe("hello from modal sandbox");

        const exec = await sandbox.exec({ command: ["cat", testFile] });
        expect(exec.exitCode).toBe(0);
        expect(exec.stdout).toBe("hello from modal sandbox");

        await expect(sandbox.listFiles(testDir)).rejects.toThrow(AdapterExecutionError);
      } finally {
        await sandbox.destroy();
      }

      expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.exec", "sandbox.destroy"]);
    },
    120_000
  );
});
