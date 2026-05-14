import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createReceipt } from "@capsule/core";
import { sqliteReceiptStore } from "./index.js";

describe("sqliteReceiptStore", () => {
  test("writes and reads receipts in startedAt order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    try {
      const store = sqliteReceiptStore(join(dir, "receipts.sqlite"));
      const second = createReceipt({
        type: "sandbox.exec",
        provider: "test",
        adapter: "test",
        capabilityPath: "sandbox.exec",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:01.000Z")
      });
      const first = createReceipt({
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        stdout: "ok"
      });

      store.write(second);
      store.write(first);

      const receipts = store.readAll();
      expect(receipts.map((receipt) => receipt.id)).toEqual([first.id, second.id]);
      expect(receipts[0]?.stdoutHash).toBe(first.stdoutHash);

      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects unsafe table names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    try {
      expect(() => sqliteReceiptStore(join(dir, "receipts.sqlite"), { tableName: "receipts; drop table receipts" })).toThrow("tableName must be an identifier");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
