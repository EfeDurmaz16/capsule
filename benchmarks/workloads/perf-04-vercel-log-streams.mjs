// PERF-04 (EDGE-02, EDGE-03): Vercel runtime log reads over finite, fragmented, malformed, endless and
// idle response bodies. MOCK: injected fetch returning synthetic Response streams; no HTTP request.
import { MiB, describeError, maxRssBytes, memory, seededRandom, settleGc, settleWithin } from "../lib/measure.mjs";
import { loadPackage } from "../lib/packages.mjs";

const { Capsule } = await loadPackage("core");
const { vercel } = await loadPackage("vercel");
const encoder = new TextEncoder();

function record(i) {
  return { level: "info", message: `synthetic runtime log ${i} ${"x".repeat(160)}`, rowId: `row-${i}`, source: "lambda", timestampInMs: 1_767_225_600_000 + i };
}

// Body factory returns { body, stats } where stats tracks emitted bytes and whether the consumer cancelled.
function streamBody(kind, params) {
  const stats = { bytesEmitted: 0, recordsEmitted: 0, cancelled: false, closed: false };
  const random = seededRandom(params.seed ?? 1);
  if (kind === "finite-array") {
    const text = JSON.stringify(Array.from({ length: params.records }, (_, i) => record(i)));
    stats.bytesEmitted = Buffer.byteLength(text);
    stats.recordsEmitted = params.records;
    stats.closed = true;
    return { body: text, stats };
  }
  if (kind === "ndjson-fragmented" || kind === "ndjson-malformed") {
    const lines = Array.from({ length: params.records }, (_, i) => JSON.stringify(record(i)));
    if (kind === "ndjson-malformed") lines[Math.floor(params.records / 2)] = '{"message":"truncated record';
    const bytes = encoder.encode(`${lines.join("\n")}\n`);
    let offset = 0;
    return {
      stats,
      body: new ReadableStream({
        pull(controller) {
          if (offset >= bytes.length) {
            stats.closed = true;
            controller.close();
            return;
          }
          // Seeded fragment sizes split records (and multi-byte boundaries) across chunks.
          const size = 1 + Math.floor(random() * params.maxFragmentBytes);
          const chunk = bytes.slice(offset, offset + size);
          offset += chunk.length;
          stats.bytesEmitted += chunk.length;
          controller.enqueue(chunk);
        },
        cancel() {
          stats.cancelled = true;
        }
      })
    };
  }
  if (kind === "endless" || kind === "idle") {
    // endless: keeps emitting NDJSON records as fast as they are pulled, up to emissionCapBytes, and then
    // stays open forever without closing. idle: one record, then open forever with no further data.
    const cap = kind === "idle" ? 1 : params.emissionCapBytes;
    let i = 0;
    return {
      stats,
      body: new ReadableStream({
        pull(controller) {
          if (stats.bytesEmitted >= cap && i > 0) {
            return new Promise(() => {});
          }
          const chunk = encoder.encode(`${JSON.stringify(record(i))}\n`);
          i += 1;
          stats.bytesEmitted += chunk.length;
          stats.recordsEmitted = i;
          controller.enqueue(chunk);
        },
        cancel() {
          stats.cancelled = true;
        }
      })
    };
  }
  throw new Error(`unknown body kind ${kind}`);
}

async function readLogs(kind, params) {
  const { body, stats } = streamBody(kind, params);
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(body, { status: 200, headers: { "content-type": kind === "finite-array" ? "application/json" : "application/x-ndjson" } });
  };
  const capsule = new Capsule({ adapter: vercel({ token: "bench-fake-token", projectId: "prj_bench", fetch: fetchImpl }) });
  await settleGc();
  const before = memory();
  const rssBefore = maxRssBytes();
  const spec = { id: "dpl_bench", providerOptions: { api: "runtime" }, ...(params.limit === undefined ? {} : { limit: params.limit }) };
  const settled = await settleWithin(capsule.edge.logs(spec), params.deadlineMs);
  // Give a cancelling implementation one turn to propagate cancel() to the source.
  await new Promise((resolve) => setImmediate(resolve));
  const after = memory();
  const entries = settled.outcome === "resolved" ? settled.value.logs.length : null;
  return {
    outcome: settled.outcome,
    settleMs: settled.settleMs,
    settledBeforeDeadline: settled.outcome !== "timeout",
    entriesReturned: entries,
    entriesWithinLimit: params.limit === undefined || entries === null ? null : entries <= params.limit,
    error: describeError(settled.error),
    requests,
    bytesEmitted: stats.bytesEmitted,
    recordsEmitted: stats.recordsEmitted,
    bodyCancelled: stats.cancelled,
    sourceClosed: stats.closed,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
    peakRssGrowthBytes: maxRssBytes() - rssBefore
  };
}

export const workload = {
  id: "perf-04-vercel-log-streams",
  perfIds: ["PERF-04"],
  manifestIds: ["EDGE-02", "EDGE-03"],
  description: "Finite, fragmented, malformed, endless and idle runtime log bodies: completion, cancellation, memory and caps (mock fetch).",
  reps: 3,
  cases: [
    {
      name: "finite-array",
      description: "JSON array body with 2000 records, limit 100.",
      params: { records: 2000, limit: 100, deadlineMs: 5000 },
      headline: ["outcome", "entriesReturned", "entriesWithinLimit", "settleMs"],
      run: ({ params }) => readLogs("finite-array", params)
    },
    {
      name: "ndjson-fragmented",
      description: "NDJSON body, 2000 records, delivered in seeded fragments of 1..64 bytes, then closed. limit 100.",
      params: { records: 2000, maxFragmentBytes: 64, limit: 100, deadlineMs: 5000, seed: 7 },
      headline: ["outcome", "entriesReturned", "entriesWithinLimit", "settleMs"],
      run: ({ params }) => readLogs("ndjson-fragmented", params)
    },
    {
      name: "ndjson-malformed",
      description: "NDJSON body with one truncated record in the middle, fragmented, then closed.",
      params: { records: 2000, maxFragmentBytes: 64, limit: 100, deadlineMs: 5000, seed: 11 },
      headline: ["outcome", "error.name", "entriesReturned"],
      run: ({ params }) => readLogs("ndjson-malformed", params)
    },
    {
      name: "endless-limit-10",
      description: "Never-closing NDJSON body emitting as fast as pulled (capped at 64 MiB emitted), limit 10, 3 s watchdog.",
      params: { emissionCapBytes: 64 * MiB, limit: 10, deadlineMs: 3000 },
      headline: ["outcome", "settleMs", "bytesEmitted", "bodyCancelled", "peakRssGrowthBytes"],
      run: ({ params }) => readLogs("endless", params)
    },
    {
      name: "idle-limit-10",
      description: "One record then an open, silent body. limit 10, 3 s watchdog.",
      params: { limit: 10, deadlineMs: 3000 },
      headline: ["outcome", "settleMs", "bodyCancelled"],
      run: ({ params }) => readLogs("idle", params)
    }
  ]
};
