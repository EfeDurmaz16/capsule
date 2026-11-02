// PERF-01 (CORE-01, CORE-02): long-lived sandbox receipt retention and required-persistence isolation.
// MOCK/SYNTHETIC: in-memory fake sandbox adapter and fake receipt stores.
import { loadPackage } from "../lib/packages.mjs";
import { describeError, memory, percentile, settleGc, sleep } from "../lib/measure.mjs";

const { Capsule } = await loadPackage("core");

function fakeAdapter(execDelay = () => 0) {
  return {
    name: "bench-fake",
    provider: "bench-fake",
    capabilities: { sandbox: { create: "native", exec: "native", fileRead: "native", fileWrite: "native", fileList: "native", destroy: "native" } },
    sandbox: {
      create: async () => ({
        handle: { id: "bench-box", provider: "bench-fake", createdAt: new Date(0).toISOString() },
        exec: async (spec) => {
          const delay = execDelay(spec);
          if (delay > 0) await sleep(delay);
          return { exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] };
        },
        writeFile: async () => {},
        readFile: async () => new Uint8Array(),
        listFiles: async () => [],
        destroy: async () => {}
      })
    }
  };
}

async function longLived(params, persistence) {
  // A non-retaining external store: it observes each receipt and keeps nothing.
  const capsule = new Capsule({ adapter: fakeAdapter(), receipts: true, receiptPersistence: persistence, receiptStore: { write() {} } });
  const box = await capsule.sandbox.create({});
  const weak = [];
  await settleGc();
  const baseline = memory();
  const checkpoints = [];
  let done = 0;
  const started = performance.now();
  for (const target of params.checkpoints) {
    while (done < target) {
      const result = await box.exec({ command: ["noop", String(done)] });
      if (result.receipt) weak.push(new WeakRef(result.receipt));
      done += 1;
    }
    await settleGc();
    const now = memory();
    checkpoints.push({
      operations: done,
      receiptsEmitted: weak.length,
      receiptsStillReachable: weak.reduce((count, ref) => count + (ref.deref() ? 1 : 0), 0),
      heapUsedDeltaBytes: now.heapUsed - baseline.heapUsed,
      rssDeltaBytes: now.rss - baseline.rss,
      heapBytesPerOperation: (now.heapUsed - baseline.heapUsed) / done
    });
  }
  const elapsedMs = performance.now() - started;
  // The sandbox handle is still live here on purpose: retention is measured while it is reachable.
  const final = checkpoints.at(-1);
  return {
    sandboxStillLive: box.handle.id === "bench-box",
    operations: done,
    opsPerSecond: (done / elapsedMs) * 1000,
    final,
    checkpoints: Object.fromEntries(checkpoints.map((checkpoint) => [`ops${checkpoint.operations}`, checkpoint]))
  };
}

// A and B run concurrently on one sandbox. A's exec finishes first, then its required receipt write is
// delayed (or fails); B's exec finishes shortly after with an immediate write. Intended behavior: B
// settles on its own write, independent of A.
async function parallelRequired(params, mode) {
  const execDelay = (spec) => (spec.command[0] === "A" ? params.aExecMs : params.bExecMs);
  const store = {
    async write(receipt) {
      if (receipt.command?.[0] !== "A") return;
      await sleep(params.aWriteMs);
      if (mode === "failing") throw new Error("synthetic A receipt write failure");
    }
  };
  const capsule = new Capsule({ adapter: fakeAdapter(execDelay), receipts: true, receiptPersistence: "required", receiptStore: store });
  const box = await capsule.sandbox.create({});
  const bLatency = [];
  const aLatency = [];
  const outcomes = { bResolved: 0, bRejected: 0, bRejectedWithAError: 0, aResolved: 0, aRejected: 0 };
  for (let i = 0; i < params.iterations; i += 1) {
    const aStart = performance.now();
    const a = box.exec({ command: ["A", String(i)] }).then(
      () => ({ ok: true, ms: performance.now() - aStart }),
      (error) => ({ ok: false, ms: performance.now() - aStart, error })
    );
    const bStart = performance.now();
    const b = box.exec({ command: ["B", String(i)] }).then(
      () => ({ ok: true, ms: performance.now() - bStart }),
      (error) => ({ ok: false, ms: performance.now() - bStart, error })
    );
    const [ar, br] = await Promise.all([a, b]);
    aLatency.push(ar.ms);
    bLatency.push(br.ms);
    outcomes[ar.ok ? "aResolved" : "aRejected"] += 1;
    if (br.ok) outcomes.bResolved += 1;
    else {
      outcomes.bRejected += 1;
      if (String(br.error?.message).includes("synthetic A receipt write failure")) outcomes.bRejectedWithAError += 1;
    }
  }
  return {
    iterations: params.iterations,
    bLatencyMs: { p50: percentile(bLatency, 50), p95: percentile(bLatency, 95) },
    aLatencyMs: { p50: percentile(aLatency, 50), p95: percentile(aLatency, 95) },
    bSettlesBeforeA: percentile(bLatency, 50) < params.aWriteMs,
    outcomes
  };
}

// In-flight bookkeeping: many sequential required-persistence operations with an immediate store.
// Retained per-operation bookkeeping shows up as heap growth per operation after GC.
async function requiredBookkeeping(params) {
  const capsule = new Capsule({ adapter: fakeAdapter(), receipts: true, receiptPersistence: "required", receiptStore: { write: async () => {} } });
  const box = await capsule.sandbox.create({});
  await box.exec({ command: ["warmup"] });
  await settleGc();
  const before = memory();
  let failures = 0;
  for (let i = 0; i < params.operations; i += 1) {
    try {
      await box.exec({ command: ["noop", String(i)] });
    } catch (error) {
      failures += 1;
      if (failures === 1) console.error(describeError(error));
    }
  }
  await settleGc();
  const after = memory();
  return {
    operations: params.operations,
    failures,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
    heapBytesPerOperation: (after.heapUsed - before.heapUsed) / params.operations,
    sandboxStillLive: box.handle.id === "bench-box"
  };
}

export const workload = {
  id: "perf-01-core-receipts",
  perfIds: ["PERF-01"],
  manifestIds: ["CORE-01", "CORE-02"],
  description: "Long-lived sandbox with increasing operations (retained receipts, heap, RSS) and parallel required persistence with delayed or failing A.",
  reps: 5,
  cases: [
    {
      name: "long-lived-best-effort",
      description: "20k sequential exec operations on one live sandbox, receipts on, best-effort persistence to a non-retaining store.",
      params: { checkpoints: [1000, 5000, 20000] },
      headline: ["final.receiptsStillReachable", "final.heapBytesPerOperation", "opsPerSecond"],
      run: ({ params }) => longLived(params, "best-effort")
    },
    {
      name: "long-lived-required",
      description: "Same as long-lived-best-effort with receiptPersistence required.",
      params: { checkpoints: [1000, 5000, 20000] },
      headline: ["final.receiptsStillReachable", "final.heapBytesPerOperation", "opsPerSecond"],
      run: ({ params }) => longLived(params, "required")
    },
    {
      name: "parallel-required-delayed-a",
      description: "A and B concurrent; A receipt write delayed 50 ms; B write immediate. Measures B latency.",
      params: { iterations: 40, aExecMs: 1, bExecMs: 3, aWriteMs: 50 },
      headline: ["bLatencyMs.p50", "bLatencyMs.p95", "bSettlesBeforeA"],
      run: ({ params }) => parallelRequired(params, "delayed")
    },
    {
      name: "parallel-required-failing-a",
      description: "A and B concurrent; A receipt write fails after 5 ms. Measures whether B is rejected by A's failure.",
      params: { iterations: 40, aExecMs: 1, bExecMs: 3, aWriteMs: 5 },
      headline: ["outcomes.bRejectedWithAError", "outcomes.aRejected", "bLatencyMs.p50"],
      run: ({ params }) => parallelRequired(params, "failing")
    },
    {
      name: "required-inflight-bookkeeping",
      description: "50k sequential required-persistence exec operations with an immediate store; heap growth per operation after GC.",
      params: { operations: 50000 },
      headline: ["heapBytesPerOperation", "failures"],
      run: ({ params }) => requiredBookkeeping(params)
    }
  ]
};
