import { appendFile, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test, vi } from "vitest";
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

// The pre-M1 readAll algorithm (whole file, split on "\n"), kept as the reference the iterator must match.
function referenceRead(text: string, path: string): { receipts: unknown[]; error?: string } {
  const receipts: unknown[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      receipts.push(JSON.parse(line));
    } catch {
      return { receipts, error: `Invalid JSONL receipt at ${path}:${index + 1}.` };
    }
  }
  return { receipts };
}

async function withFile<T>(content: string, body: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-iter-"));
  try {
    const path = join(dir, "receipts.jsonl");
    await writeFile(path, content, "utf8");
    return await body(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}

describe("PERF-11: incremental reader with a bounded line size", () => {
  // Lines longer than the 1 MiB read chunk, multi-byte characters across chunk edges, CRLF, blank
  // lines and a final line without a line break.
  const big = "\u00e9\u4e2d\ud83d\ude00".repeat(150_000);
  const lines = [
    JSON.stringify({ id: "a", note: "plain" }),
    "",
    `${JSON.stringify({ id: "b", note: big })}\r`,
    "   ",
    JSON.stringify({ id: "c", note: big.slice(3) }),
    ...Array.from({ length: 3000 }, (_, index) => JSON.stringify({ id: `n${index}`, pad: "x".repeat(index % 97) })),
    JSON.stringify({ id: "last" })
  ];

  test("iterate and readAll return exactly what the whole-file reader returned", async () => {
    await withFile(lines.join("\n"), async (path) => {
      const expected = referenceRead(lines.join("\n"), path);
      const store = jsonlReceiptStore(path);
      expect(await collect(store.iterate())).toEqual(expected.receipts);
      expect(await store.readAll()).toEqual(expected.receipts);
    });
    await withFile(`${lines.join("\n")}\n`, async (path) => {
      expect(await jsonlReceiptStore(path).readAll()).toEqual(referenceRead(`${lines.join("\n")}\n`, path).receipts);
    });
  });

  test("a multi-byte character cut by the 1 MiB chunk edge decodes as in the whole file", async () => {
    for (const offset of [1, 2, 3]) {
      // {"id":"<pad>😀"} with the 4-byte emoji starting `offset` bytes before the chunk edge.
      const pad = "p".repeat(1024 * 1024 - 7 - offset);
      const content = `${JSON.stringify({ id: `${pad}\ud83d\ude00` })}\n${JSON.stringify({ id: "\u00e9" })}\n`;
      await withFile(content, async (path) => {
        expect(await jsonlReceiptStore(path).readAll()).toEqual(referenceRead(content, path).receipts);
      });
    }
  });

  test("a corrupt line is reported at the same line number as before, after the earlier receipts", async () => {
    for (const corruptAt of [1, 4, 2500, lines.length]) {
      const content = lines.map((line, index) => (index + 1 === corruptAt ? '{"id":"truncated' : line)).join("\n");
      await withFile(content, async (path) => {
        const expected = referenceRead(content, path);
        expect(expected.error).toBeDefined();
        const store = jsonlReceiptStore(path);
        await expect(store.readAll()).rejects.toThrow(expected.error!);
        const seen: unknown[] = [];
        await expect(
          (async () => {
            for await (const receipt of store.iterate()) seen.push(receipt);
          })()
        ).rejects.toThrow(expected.error!);
        expect(seen).toEqual(expected.receipts);
      });
    }
  });

  test("a line longer than maxLineBytes fails with its line number; one at the limit passes", async () => {
    const content = ['{"id":"a"}', `{"id":"${"x".repeat(100)}"}`, '{"id":"c"}'].join("\n");
    await withFile(content, async (path) => {
      const limit = Buffer.byteLength(`{"id":"${"x".repeat(100)}"}`);
      await expect(jsonlReceiptStore(path, { maxLineBytes: limit }).readAll()).resolves.toHaveLength(3);
      await expect(jsonlReceiptStore(path, { maxLineBytes: limit - 1 }).readAll()).rejects.toThrow(
        `${path}:2 is longer than maxLineBytes (${limit - 1} bytes)`
      );
      await expect(jsonlReceiptStore(path).readAll({ maxLineBytes: limit - 1 })).rejects.toThrow(`${path}:2 is longer`);
    });
    // A line spanning many read chunks is cut off once it passes the limit, not after it is complete.
    await withFile(`{"id":"${"y".repeat(8 * 1024 * 1024)}"}\n`, async (path) => {
      const reads: number[] = [];
      const probe = await open(path, "r");
      const proto = Object.getPrototypeOf(probe) as { read: (...args: unknown[]) => Promise<{ bytesRead: number }> };
      await probe.close();
      const original = proto.read;
      const spy = vi.spyOn(proto, "read").mockImplementation(async function (this: unknown, ...args: unknown[]) {
        const result = await original.apply(this, args);
        reads.push(result.bytesRead);
        return result;
      });
      try {
        await expect(jsonlReceiptStore(path, { maxLineBytes: 1024 * 1024 }).readAll()).rejects.toThrow(`${path}:1 is longer`);
      } finally {
        spy.mockRestore();
      }
      // At most the limit plus the 1 MiB chunk being read, and one more chunk in flight: not the 8 MiB line.
      expect(reads.reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(3 * 1024 * 1024);
      expect(Math.max(...reads)).toBeLessThanOrEqual(1024 * 1024);
    });
    expect(() => jsonlReceiptStore("unused.jsonl", { maxLineBytes: 0 })).toThrow("maxLineBytes must be a positive integer");
  });

  test("stopping early closes the file and lines appended during iteration are not returned", async () => {
    // Open descriptors of this process (/dev/fd on macOS and Linux). FileHandle.close is an instance field,
    // so the count is the observable signal that the reader closed its file.
    const openDescriptors = () => readdirSync("/dev/fd").length;
    await withFile(lines.join("\n"), async (path) => {
      const store = jsonlReceiptStore(path);
      const before = openDescriptors();
      const firstTwo: unknown[] = [];
      for await (const receipt of store.iterate()) {
        firstTwo.push(receipt);
        if (firstTwo.length === 2) {
          expect(openDescriptors()).toBe(before + 1);
          break;
        }
      }
      expect(firstTwo).toHaveLength(2);
      expect(openDescriptors()).toBe(before);

      const expectedCount = referenceRead(lines.join("\n"), path).receipts.length;
      let count = 0;
      for await (const _receipt of store.iterate()) {
        if (count === 0) await appendFile(path, `\n${JSON.stringify({ id: "appended" })}\n`);
        count += 1;
      }
      expect(count).toBe(expectedCount);
      expect(openDescriptors()).toBe(before);
    });
  });

  test("a missing file yields nothing and a closed store rejects iteration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capsule-jsonl-iter-"));
    try {
      const store = jsonlReceiptStore(join(dir, "missing.jsonl"));
      expect(await collect(store.iterate())).toEqual([]);
      await store.close();
      await expect(collect(store.iterate())).rejects.toThrow("JSONL receipt store is closed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
