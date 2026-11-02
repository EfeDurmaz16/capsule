// Shared measurement helpers for the synthetic benchmark harness. Every workload uses injected fake
// clients or local fixtures only; nothing here contacts a provider.
import { createHash } from "node:crypto";

export const MiB = 1024 * 1024;

export async function settleGc() {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Benchmarks must run with --expose-gc (use benchmarks/run.mjs).");
  }
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc();
  }
}

export function memory() {
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss, external: usage.external, arrayBuffers: usage.arrayBuffers };
}

// Peak resident set size of this process in bytes (resourceUsage().maxRSS is reported in KiB).
export function maxRssBytes() {
  return process.resourceUsage().maxRSS * 1024;
}

export function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic PRNG (mulberry32) so synthetic workloads are identical across runs and commits.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Settle a promise against a watchdog deadline without throwing, so a hang is recorded as data.
export async function settleWithin(promise, deadlineMs) {
  const started = performance.now();
  let timer;
  const watchdog = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ outcome: "timeout" }), deadlineMs);
  });
  const settled = promise.then(
    (value) => ({ outcome: "resolved", value }),
    (error) => ({ outcome: "rejected", error })
  );
  const result = await Promise.race([settled, watchdog]);
  clearTimeout(timer);
  return { ...result, settleMs: performance.now() - started };
}

export function describeError(error) {
  if (error === undefined || error === null) return null;
  if (!(error instanceof Error)) return { name: typeof error, message: String(error) };
  return { name: error.name, constructor: error.constructor?.name, message: error.message.slice(0, 500) };
}
