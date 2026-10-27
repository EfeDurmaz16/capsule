// PERF-11 (EV-01 dependency): JSONL receipt store readAll memory and corruption location, the incremental
// iterator (when the measured build has one) and the CLI `receipt verify` end to end.
// SYNTHETIC: receipts generated locally with createReceipt and written to a temporary file.
import { spawnSync } from "node:child_process";
import { mkdtempSync, openSync, readFileSync, rmSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MiB, describeError, maxRssBytes, memory, settleGc, sha256 } from "../lib/measure.mjs";
import { cliEntry, loadPackage } from "../lib/packages.mjs";

const probe = fileURLToPath(new URL("../lib/exit-probe.mjs", import.meta.url));

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
    // A build without the incremental reader fails the run instead of reporting an empty measurement.
    if (params.mode === "iterate" && typeof store.iterate !== "function") throw new Error("not available in this build: JsonlReceiptStore.iterate");
    await settleGc();
    const before = memory();
    const rssBefore = maxRssBytes();
    const started = performance.now();
    let receipts;
    let error;
    let count = null;
    try {
      if (params.mode === "iterate") {
        count = 0;
        // Nothing is retained: the incremental reader's own memory is what peak RSS shows.
        for await (const _receipt of store.iterate()) count += 1;
      } else {
        receipts = await store.readAll();
        count = receipts.length;
      }
    } catch (caught) {
      error = caught;
    }
    const elapsedMs = performance.now() - started;
    const peakRssGrowthBytes = maxRssBytes() - rssBefore;
    const heapWhileHeld = memory().heapUsed - before.heapUsed;
    const idsDigest = receipts ? sha256(receipts.map((receipt) => receipt.id).join("\n")) : null;
    receipts = undefined;
    await store.close();
    return {
      receiptsWritten: params.receipts,
      fileBytes,
      outcome: error ? "rejected" : "resolved",
      receiptsRead: count,
      idsDigest,
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

// CLI `capsule receipt verify --receipt-file` over the same file: wall time, the CLI process's peak RSS
// (exit probe) and a digest of its JSON report as output parity.
async function cliVerify(params) {
  const dir = mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "jsonl-cli-"));
  try {
    const path = join(dir, "receipts.jsonl");
    const fileBytes = writeFixture(path, params.receipts, params.corruptLine);
    const probeOut = join(dir, "probe.json");
    const started = performance.now();
    const child = spawnSync(process.execPath, ["--import", probe, cliEntry(), "receipt", "verify", "--receipt-file", "receipts.jsonl"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 512 * MiB,
      env: { PATH: process.env.PATH, HOME: dir, CAPSULE_BENCH_PROBE_OUT: probeOut, NO_COLOR: "1" },
      timeout: 120_000
    });
    const wallMs = performance.now() - started;
    const probed = JSON.parse(readFileSync(probeOut, "utf8"));
    let summary = null;
    try {
      summary = JSON.parse(child.stdout).summary;
    } catch {
      summary = null;
    }
    return {
      fileBytes,
      exitCode: child.status,
      wallMs,
      cliMaxRssBytes: probed.maxRssBytes,
      stdoutBytes: Buffer.byteLength(child.stdout ?? ""),
      stdoutDigest: sha256(child.stdout ?? ""),
      summary
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
      abHeadline: ["heapUsedWhileHeldBytes", "idsDigest"],
      run: ({ params }) => run(params)
    },
    {
      name: "iterate-50k",
      params: { receipts: 50000, mode: "iterate" },
      description: "50k receipts read with the incremental iterator, nothing retained (builds without iterate report an error).",
      headline: ["receiptsRead", "peakRssGrowthBytes", "elapsedMs"],
      run: ({ params }) => run(params)
    },
    {
      name: "cli-verify-50k",
      params: { receipts: 50000 },
      description: "capsule receipt verify over 50k receipts: CLI wall time, CLI peak RSS and report digest.",
      headline: ["exitCode", "stdoutDigest", "cliMaxRssBytes", "wallMs"],
      run: ({ params }) => cliVerify(params)
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
