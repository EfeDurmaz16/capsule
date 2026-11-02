// PERF-02 (IO-01): artifact collection bytes read and peak memory under budgets.
// SYNTHETIC: generated local files in a temporary directory; no provider involved.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { MiB, maxRssBytes, memory, settleGc, sha256 } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

// Count bytes the collector actually reads through node:fs, whichever sync read API it uses.
function installReadCounter() {
  const counter = { bytes: 0, calls: 0 };
  const original = { readFileSync: fs.readFileSync, readSync: fs.readSync };
  let insideReadFile = false;
  fs.readFileSync = function (...args) {
    insideReadFile = true;
    let value;
    try {
      value = original.readFileSync.apply(this, args);
    } finally {
      insideReadFile = false;
    }
    counter.calls += 1;
    counter.bytes += typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
    return value;
  };
  fs.readSync = function (...args) {
    const read = original.readSync.apply(this, args);
    // readFileSync may be implemented on top of readSync; count those bytes once.
    if (insideReadFile) return read;
    counter.calls += 1;
    counter.bytes += read;
    return read;
  };
  syncBuiltinESMExports();
  return counter;
}

function makeDir() {
  return fs.mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "artifacts-"));
}

async function collect(dir, options) {
  const { collectFileArtifacts } = await loadPackage("core");
  const counter = installReadCounter();
  await settleGc();
  const before = memory();
  const rssBefore = maxRssBytes();
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  counter.bytes = 0;
  counter.calls = 0;
  const started = performance.now();
  const result = collectFileArtifacts(dir, options);
  const elapsedMs = performance.now() - started;
  await new Promise((resolve) => setImmediate(resolve));
  histogram.disable();
  const after = memory();
  return {
    result,
    metrics: {
      elapsedMs,
      bytesRead: counter.bytes,
      readCalls: counter.calls,
      peakRssBytes: maxRssBytes(),
      peakRssGrowthBytes: maxRssBytes() - rssBefore,
      heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
      eventLoopMaxDelayMs: histogram.max / 1e6,
      collectedFiles: result.artifacts.length,
      truncated: result.truncated,
      truncationReason: result.truncation?.reason ?? null
    }
  };
}

function inventoryDigest(artifacts) {
  return sha256(JSON.stringify(artifacts.map((artifact) => [artifact.path, artifact.sizeBytes, artifact.sha256])));
}

export const workload = {
  id: "perf-02-artifact-collection",
  perfIds: ["PERF-02"],
  manifestIds: ["IO-01"],
  description: "Large artifact under a tiny limit (bytes read, peak memory), large artifact within budget and many small files (inventory/hash parity).",
  reps: 5,
  cases: [
    {
      name: "large-file-tiny-limit",
      description: "One 16 MiB file, maxBytes 1. Intended: the file is not read in full.",
      params: { fileBytes: 16 * MiB, maxBytes: 1 },
      headline: ["bytesRead", "peakRssGrowthBytes", "truncationReason"],
      run: async ({ params }) => {
        const dir = makeDir();
        try {
          // Sparse file: setup must not raise this process's peak RSS before the measured collection.
          const path = join(dir, "large.bin");
          fs.writeFileSync(path, "");
          fs.truncateSync(path, params.fileBytes);
          const { metrics } = await collect(dir, { maxBytes: params.maxBytes });
          return metrics;
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    },
    {
      name: "large-file-within-budget",
      description: "One 48 MiB file under the default budget. Hash must equal an independent sha256.",
      params: { fileBytes: 48 * MiB },
      headline: ["bytesRead", "peakRssGrowthBytes", "elapsedMs", "hashMatches"],
      run: async ({ params }) => {
        const dir = makeDir();
        try {
          // Written and hashed in 1 MiB chunks so setup does not raise the peak RSS being measured.
          const chunk = Buffer.alloc(MiB);
          const hash = createHash("sha256");
          const fd = fs.openSync(join(dir, "large.bin"), "w");
          for (let offset = 0; offset < params.fileBytes; offset += MiB) {
            for (let i = 0; i < chunk.length; i += 4096) chunk[i] = ((offset + i) / 4096) % 251;
            fs.writeSync(fd, chunk);
            hash.update(chunk);
          }
          fs.closeSync(fd);
          const expected = hash.digest("hex");
          const { result, metrics } = await collect(dir, {});
          return { ...metrics, hashMatches: result.artifacts[0]?.sha256 === expected };
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    },
    {
      name: "many-small-files",
      description: "1000 files of 4 KiB across 20 directories (the default maxFiles), default budgets. Inventory digest is the parity check.",
      params: { directories: 20, filesPerDirectory: 50, fileBytes: 4096 },
      headline: ["elapsedMs", "collectedFiles", "inventoryDigest"],
      run: async ({ params }) => {
        const dir = makeDir();
        try {
          for (let d = 0; d < params.directories; d += 1) {
            const sub = join(dir, `dir-${String(d).padStart(2, "0")}`);
            fs.mkdirSync(sub);
            for (let f = 0; f < params.filesPerDirectory; f += 1) {
              fs.writeFileSync(join(sub, `file-${String(f).padStart(3, "0")}.txt`), Buffer.alloc(params.fileBytes, (d * 31 + f) % 256));
            }
          }
          const { result, metrics } = await collect(dir, {});
          return { ...metrics, inventoryDigest: inventoryDigest(result.artifacts) };
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  ]
};
