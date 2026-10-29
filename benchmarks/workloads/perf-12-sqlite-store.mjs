// PERF-12: SQLite receipt store write and read cost, with statement preparation separated from execution
// and from the synchronous disk commit.
// SYNTHETIC: receipts generated locally with createReceipt; the database is a temporary file or :memory:.
//
// prepareCalls and prepareMs come from wrapping DatabaseSync.prototype.prepare, so they count every
// statement the store prepares, whatever build is measured. A :memory: database has no disk commit, so
// file minus memory elapsed approximates the commit cost of the autocommitted INSERTs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describeError, maxRssBytes, memory, settleGc } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

const { createReceipt } = await loadPackage("core");
const { sqliteReceiptStore } = await loadPackage("store-sqlite");

function receipts(count) {
  return Array.from({ length: count }, (_, i) =>
    createReceipt({
      type: "sandbox.exec",
      provider: "bench-fake",
      adapter: "bench-fake",
      capabilityPath: "sandbox.exec",
      supportLevel: "native",
      startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, count - i)),
      finishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1, count - i)),
      command: ["node", "-e", `synthetic-${i}`],
      resource: { id: `box-${i % 100}`, status: "running" }
    })
  );
}

function expectedOrder(inputs) {
  const byId = new Map();
  for (const receipt of inputs) byId.set(receipt.id, receipt);
  return [...byId.values()]
    .sort((left, right) =>
      left.startedAt < right.startedAt ? -1 : left.startedAt > right.startedAt ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )
    .map((receipt) => receipt.id);
}

function instrumentPrepare() {
  const original = DatabaseSync.prototype.prepare;
  const stats = { prepareCalls: 0, prepareMs: 0 };
  DatabaseSync.prototype.prepare = function prepare(...args) {
    const started = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      stats.prepareCalls += 1;
      stats.prepareMs += performance.now() - started;
    }
  };
  return { stats, restore: () => (DatabaseSync.prototype.prepare = original) };
}

async function run(params) {
  const dir = mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "sqlite-"));
  const inputs = receipts(params.writes);
  // A replaced id keeps INSERT OR REPLACE on the measured path: the last write rewrites the first row.
  inputs.push({ ...inputs[0], finishedAt: new Date(Date.UTC(2026, 0, 2)).toISOString() });
  const probe = instrumentPrepare();
  try {
    const store = sqliteReceiptStore(params.memory ? ":memory:" : join(dir, "receipts.sqlite"));
    await settleGc();
    const before = memory();
    const rssBefore = maxRssBytes();
    probe.stats.prepareCalls = 0;
    probe.stats.prepareMs = 0;
    let error;
    let rows;
    const writeStarted = performance.now();
    let writeMs = 0;
    let readMs = 0;
    let writePrepareCalls = 0;
    let writePrepareMs = 0;
    try {
      for (const receipt of inputs) store.write(receipt);
      writeMs = performance.now() - writeStarted;
      writePrepareCalls = probe.stats.prepareCalls;
      writePrepareMs = probe.stats.prepareMs;
      const readStarted = performance.now();
      for (let i = 0; i < params.reads; i += 1) rows = store.readAll();
      readMs = performance.now() - readStarted;
    } catch (caught) {
      error = caught;
    }
    const after = memory();
    store.close();
    let closedError;
    try {
      store.write(inputs[1]);
    } catch (caught) {
      closedError = caught;
    }
    return {
      writes: inputs.length,
      reads: params.reads,
      database: params.memory ? "memory" : "file",
      outcome: error ? "rejected" : "resolved",
      error: describeError(error),
      writeMs,
      writeUsPerReceipt: (writeMs * 1000) / inputs.length,
      writePrepareCalls,
      writePrepareMs,
      writeExecuteMs: writeMs - writePrepareMs,
      readMs,
      readPrepareCalls: probe.stats.prepareCalls - writePrepareCalls,
      rowsRead: rows?.length ?? null,
      // Ordering and replacement parity: readAll returns one row per id (the last write wins) ordered by
      // startedAt then id. Receipt ids are random, so the expected order is computed from the inputs.
      orderMatchesExpected: rows ? JSON.stringify(rows.map((row) => row.id)) === JSON.stringify(expectedOrder(inputs)) : null,
      replacedFinishedAt: rows?.find((row) => row.id === inputs[0].id)?.finishedAt ?? null,
      closedError: closedError?.message ?? null,
      peakRssGrowthBytes: maxRssBytes() - rssBefore,
      heapUsedDeltaBytes: after.heapUsed - before.heapUsed
    };
  } finally {
    probe.restore();
    rmSync(dir, { recursive: true, force: true });
  }
}

const headline = ["writeMs", "writePrepareCalls", "writePrepareMs", "writeExecuteMs", "readMs", "orderMatchesExpected", "replacedFinishedAt"];

export const workload = {
  id: "perf-12-sqlite-store",
  perfIds: ["PERF-12"],
  manifestIds: ["PERF-12"],
  description: "SQLite receipt store: write and readAll cost with statement preparation separated from execution and disk commit.",
  reps: 5,
  cases: [
    {
      name: "file-2000-writes",
      params: { writes: 2000, reads: 5, memory: false },
      description: "2000 autocommitted writes plus one replacement to a file database, then 5 readAll calls.",
      headline,
      run: ({ params }) => run(params)
    },
    {
      name: "memory-2000-writes",
      params: { writes: 2000, reads: 5, memory: true },
      description: "The same on :memory:, which has no disk commit: preparation and execution cost only.",
      headline,
      run: ({ params }) => run(params)
    }
  ]
};
