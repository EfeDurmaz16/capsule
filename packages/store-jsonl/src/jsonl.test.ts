import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { createReceipt } from "@capsule/core";
import { jsonlReceiptStore } from "./index.js";

describe("jsonlReceiptStore", () => {
  test("writes and reads receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const store = jsonlReceiptStore(join(dir, "receipts.jsonl"));
      const receipt = createReceipt({
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        stdout: "ok"
      });
      await store.write(receipt);
      const receipts = await store.readAll();
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.stdoutHash).toBe(receipt.stdoutHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
