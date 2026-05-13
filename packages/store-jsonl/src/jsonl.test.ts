import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
