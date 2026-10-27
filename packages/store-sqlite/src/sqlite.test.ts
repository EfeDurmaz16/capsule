import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
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

describe("deferred M1 items (visible skips with reason and dependency)", () => {
  // PERF-12 deferred: the manifest reuses prepared statements only if a benchmark shows prepare cost
  // matters separately from the synchronous commit. The M1 harness has no SQLite workload, so there is no
  // such measurement. Dependency: a store-sqlite workload separating prepare from commit cost, then reuse
  // that preserves insert/read ordering, INSERT OR REPLACE semantics and closed-store errors.
  test.skip("PERF-12 (deferred): reused prepared statements keep ordering, replacement and closed-store errors", () => {
    // Intended assertion once implemented: the same sequence of writes and reads returns identical rows and
    // errors with statement reuse as without it.
  });
});
