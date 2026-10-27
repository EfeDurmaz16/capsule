// PERF-11 (EV-01 dependency): JSONL receipt store readAll memory and corruption location.
// SYNTHETIC: receipts generated locally with createReceipt and written to a temporary file.
import { mkdtempSync, openSync, rmSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiB, describeError, maxRssBytes, memory, settleGc } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

const { createReceipt } = await loadPackage("core");
const { jsonlReceiptStore } = await loadPackage("store-jsonl");

function writeFixture(path, count, corruptLine) {
  const fd = openSync(path, "w");
  let bytes = 0;
  let batch = "";
  for (let i = 0; i < count; i += 1) {
    const receipt = createReceipt({
      type: "sandbox.exec",
      provider: "bench-fake",
      adapter: "bench-fake",
      capabilityPath: "sandbox.exec",
      supportLevel: "native",
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)),
      finishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1, i)),
      command: ["node", "-e", `synthetic-${i}`],
      resource: { id: `box-${i % 100}`, status: "running" }
    });
    const line = i + 1 === corruptLine ? '{"id":"truncated' : JSON.stringify(receipt);
    batch += `${line}\n`;
    if (batch.length > MiB) {
      bytes += writeSync(fd, batch);
      batch = "";
    }
  }
  bytes += writeSync(fd, batch);
  closeSync(fd);
  return bytes;
}

async function run(params) {
  const dir = mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "jsonl-"));
  try {
    const path = join(dir, "receipts.jsonl");
    const fileBytes = writeFixture(path, params.receipts, params.corruptLine);
    const store = jsonlReceiptStore(path);
    await settleGc();
    const before = memory();
    const rssBefore = maxRssBytes();
    const started = performance.now();
    let receipts;
    let error;
    try {
      receipts = await store.readAll();
    } catch (caught) {
      error = caught;
    }
    const elapsedMs = performance.now() - started;
    const peakRssGrowthBytes = maxRssBytes() - rssBefore;
    const heapWhileHeld = memory().heapUsed - before.heapUsed;
    const count = receipts?.length ?? null;
    receipts = undefined;
    await store.close();
    return {
      receiptsWritten: params.receipts,
      fileBytes,
      outcome: error ? "rejected" : "resolved",
      receiptsRead: count,
      error: describeError(error),
      errorNamesCorruptLine: params.corruptLine ? Boolean(error?.message?.includes(`:${params.corruptLine}`)) : null,
      elapsedMs,
      peakRssGrowthBytes,
      heapUsedWhileHeldBytes: heapWhileHeld
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const workload = {
  id: "perf-11-jsonl-read",
  perfIds: ["PERF-11"],
  manifestIds: ["EV-01"],
  description: "JSONL receipt store readAll over a large synthetic file: elapsed, peak RSS and corruption line location.",
  reps: 3,
  cases: [
    {
      name: "read-50k",
      params: { receipts: 50000 },
      description: "50k receipts, valid file.",
      headline: ["receiptsRead", "fileBytes", "peakRssGrowthBytes", "elapsedMs"],
      run: ({ params }) => run(params)
    },
    {
      name: "corrupt-line-25000",
      params: { receipts: 50000, corruptLine: 25000 },
      description: "50k receipts with line 25000 truncated; the error must name the line.",
      headline: ["outcome", "errorNamesCorruptLine", "peakRssGrowthBytes"],
      run: ({ params }) => run(params)
    }
  ]
};
