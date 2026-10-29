import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test, vi } from "vitest";
import { createReceipt } from "@capsule-sdk/core";
import { sqliteReceiptStore } from "./index.js";

function receiptAt(offsetMs: number) {
  return createReceipt({
    type: "job.run",
    provider: "test",
    adapter: "test",
    capabilityPath: "job.run",
    supportLevel: "native",
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, offsetMs)),
    stdout: `ok-${offsetMs}`
  });
}

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

  test("ready verifies the open database handle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    try {
      const store = sqliteReceiptStore(join(dir, "receipts.sqlite"));

      expect(() => store.ready()).not.toThrow();
      store.close();
      expect(() => store.ready()).toThrow("SQLite receipt store is closed");
      expect(() => store.write(receiptAt(0))).toThrow("SQLite receipt store is closed");
      expect(() => store.readAll()).toThrow("SQLite receipt store is closed");
      expect(() => store.close()).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readAll fails with receipt id context for corrupt stored JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    try {
      const path = join(dir, "receipts.sqlite");
      const receipt = receiptAt(0);
      const store = sqliteReceiptStore(path);
      store.write(receipt);
      store.close();

      const db = new DatabaseSync(path);
      try {
        db.prepare("UPDATE capsule_receipts SET receipt_json = ? WHERE id = ?").run("not-json", receipt.id);
      } finally {
        db.close();
      }

      const reader = sqliteReceiptStore(path);
      try {
        expect(() => reader.readAll()).toThrow(`Invalid SQLite receipt JSON for receipt ${receipt.id}`);
      } finally {
        reader.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps all writes from concurrent local store handles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    try {
      const path = join(dir, "receipts.sqlite");
      const first = sqliteReceiptStore(path);
      const second = sqliteReceiptStore(path);
      const receipts = Array.from({ length: 12 }, (_, index) => receiptAt(index));

      await Promise.all(receipts.map(async (receipt, index) => (index % 2 === 0 ? first : second).write(receipt)));

      expect(first.readAll().map((receipt) => receipt.id)).toEqual(receipts.map((receipt) => receipt.id));
      first.close();
      second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("PERF-12: prepared statements are reused", () => {
  test("many writes and reads prepare one INSERT and one SELECT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      const store = sqliteReceiptStore(join(dir, "receipts.sqlite"));
      prepare.mockClear();
      for (let index = 0; index < 50; index += 1) store.write(receiptAt(index));
      for (let index = 0; index < 5; index += 1) expect(store.readAll()).toHaveLength(50);
      expect(prepare).toHaveBeenCalledTimes(2);
      store.close();
    } finally {
      prepare.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reused statements keep ordering, INSERT OR REPLACE, failed-write recovery and closed-store errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-sqlite-test-"));
    try {
      const store = sqliteReceiptStore(join(dir, "receipts.sqlite"));
      const late = receiptAt(30);
      const early = receiptAt(10);
      store.write(late);
      store.write(early);
      expect(store.readAll().map((receipt) => receipt.id)).toEqual([early.id, late.id]);

      // Same id again: the row is replaced, not duplicated, and the order follows the new startedAt.
      const replaced = { ...early, startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)).toISOString(), stdoutHash: "replaced" };
      store.write(replaced);
      expect(store.readAll().map((receipt) => [receipt.id, receipt.stdoutHash])).toEqual([
        [late.id, late.stdoutHash],
        [early.id, "replaced"]
      ]);

      // A write that SQLite rejects (NOT NULL type) leaves the reused statement usable.
      expect(() => store.write({ ...receiptAt(40), type: null } as never)).toThrow();
      const after = receiptAt(50);
      store.write(after);
      expect(store.readAll().map((receipt) => receipt.id)).toEqual([late.id, after.id, early.id]);

      store.close();
      expect(() => store.write(receiptAt(60))).toThrow("SQLite receipt store is closed");
      expect(() => store.readAll()).toThrow("SQLite receipt store is closed");
      expect(() => store.close()).not.toThrow();

      // The rows written through reused statements are what a new handle reads.
      const reader = sqliteReceiptStore(join(dir, "receipts.sqlite"));
      expect(reader.readAll().map((receipt) => receipt.id)).toEqual([late.id, after.id, early.id]);
      reader.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
