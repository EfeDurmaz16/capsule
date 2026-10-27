import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { createReceipt } from "@capsule-sdk/core";
import { jsonlReceiptStore } from "./index.js";

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
      const text = await readFile(join(dir, "receipts.jsonl"), "utf8");
      expect(text.endsWith("\n")).toBe(true);
      expect(JSON.parse(text.trim()).id).toBe(receipt.id);

      const receipts = await store.readAll();
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.stdoutHash).toBe(receipt.stdoutHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readAll returns an empty list for missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const store = jsonlReceiptStore(join(dir, "missing", "receipts.jsonl"));
      await expect(store.readAll()).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ready preflights append access and creates the parent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const path = join(dir, "nested", "receipts.jsonl");
      const store = jsonlReceiptStore(path);

      await store.ready();

      await expect(readFile(path, "utf8")).resolves.toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readAll preserves append order and skips blank lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const path = join(dir, "receipts.jsonl");
      const first = createReceipt({
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z")
      });
      const second = createReceipt({
        type: "sandbox.exec",
        provider: "test",
        adapter: "test",
        capabilityPath: "sandbox.exec",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:01.000Z")
      });
      await writeFile(path, `${JSON.stringify(first)}\n\n${JSON.stringify(second)}\n`, "utf8");

      const receipts = await jsonlReceiptStore(path).readAll();
      expect(receipts.map((receipt) => receipt.id)).toEqual([first.id, second.id]);
      expect(receipts.map((receipt) => receipt.type)).toEqual(["job.run", "sandbox.exec"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("readAll fails with path and line context for corrupt JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const path = join(dir, "receipts.jsonl");
      const receipt = receiptAt(0);
      await writeFile(path, `${JSON.stringify(receipt)}\nnot-json\n`, "utf8");

      await expect(jsonlReceiptStore(path).readAll()).rejects.toThrow(`Invalid JSONL receipt at ${path}:2`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("serializes concurrent writes on one store instance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const path = join(dir, "receipts.jsonl");
      const store = jsonlReceiptStore(path);
      const receipts = Array.from({ length: 12 }, (_, index) => receiptAt(index));

      await Promise.all(receipts.map((receipt) => store.write(receipt)));

      const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
      const persisted = await store.readAll();
      expect(lines).toHaveLength(receipts.length);
      expect(persisted.map((receipt) => receipt.id)).toEqual(receipts.map((receipt) => receipt.id));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("close waits for queued writes and rejects later operations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-test-"));
    try {
      const path = join(dir, "receipts.jsonl");
      const store = jsonlReceiptStore(path);
      const receipts = [receiptAt(0), receiptAt(1)];
      const writes = Promise.all(receipts.map((receipt) => store.write(receipt)));

      await store.close();
      await writes;

      const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
      expect(lines).toHaveLength(receipts.length);
      await expect(store.ready()).rejects.toThrow("JSONL receipt store is closed");
      await expect(store.write(receiptAt(2))).rejects.toThrow("JSONL receipt store is closed");
      await expect(store.readAll()).rejects.toThrow("JSONL receipt store is closed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("deferred M1 items (visible skips with reason and dependency)", () => {
  // PERF-11 deferred: an incremental receipt iterator with a bounded line size and a compatible readAll
  // wrapper is an additive API that needs review. The M1 harness (perf-11-jsonl-read) records readAll
  // memory and time before and after M1 with this package unchanged. Dependency: additive API review for
  // the iterator, then a before/after run of perf-11 showing bounded reader memory with the same verify
  // semantics and corruption line locations.
  test.skip("PERF-11 (deferred): an incremental reader keeps memory bounded with readAll semantics unchanged", () => {
    // Intended assertion: iterating 50k receipts holds at most one bounded line in memory, reports the same
    // corrupt line number as readAll, and closes the file on early exit.
  });
});
