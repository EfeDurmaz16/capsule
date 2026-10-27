// PERF-05: bounded Kubernetes pod log capture. Injected fake clients only; no cluster.
import { describe, expect, it } from "vitest";
import { Capsule, CaptureLimitError, defaultCaptureBounds } from "@capsule-sdk/core";
import { kubernetes } from "./index.js";

type LogRead = { name: string; container?: string; tailLines?: number; limitBytes?: number };

function podsCapsule(podCount: number, read: (input: LogRead) => Promise<string>, lists: unknown[] = []) {
  const pods = Array.from({ length: podCount }, (_, index) => ({
    metadata: { name: `pod-${String(index).padStart(2, "0")}` },
    spec: { containers: [{ name: "web", env: [{ name: "TOKEN", value: `synthetic-secret-${index}` }] }] }
  }));
  return new Capsule({
    adapter: kubernetes({
      clients: {
        batch: {} as never,
        apps: {} as never,
        core: {
          readNamespacedService: async () => ({ metadata: { name: "svc" }, spec: { selector: { app: "svc" } } }),
          listNamespacedPod: async (input: unknown) => {
            lists.push(input);
            return { items: pods };
          },
          readNamespacedPodLog: read
        } as never
      }
    }),
    policy: { secrets: { redactFromLogs: true } }
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("kubernetes bounded log capture (PERF-05)", () => {
  it("keeps at most bounds.concurrency reads in flight and returns the same ordered, redacted result", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const capsule = podsCapsule(10, async ({ name }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Later pods answer first so completion order differs from list order.
      await delay(20 - Number(name.slice(4)));
      inFlight -= 1;
      const index = Number(name.slice(4));
      return `2026-10-25T10:00:${String(index).padStart(2, "0")}.000000000Z line token=synthetic-secret-${index}\n`;
    });
    const result = await capsule.service.logs({ id: "svc", limit: 4, bounds: { concurrency: 3 } });
    expect(maxInFlight).toBe(3);
    expect(result.logs.map((entry) => entry.source)).toEqual(["pod-06", "pod-07", "pod-08", "pod-09"]);
    expect(result.logs.every((entry) => entry.message === "line token=[REDACTED]")).toBe(true);
    expect(result.truncation).toEqual({ truncated: false, capturedBytes: 4 * "line token=[REDACTED]".length, capturedRecords: 4 });
  });

  it("bounds every per-source read with a tail and a byte cap even when no limit is given", async () => {
    const reads: LogRead[] = [];
    const capsule = podsCapsule(1, async (input) => {
      reads.push(input);
      return "2026-10-25T10:00:00Z one\n";
    });
    await capsule.service.logs({ id: "svc" });
    expect(reads[0]).toMatchObject({ tailLines: defaultCaptureBounds.maxRecords, limitBytes: defaultCaptureBounds.maxBytes });
  });

  it("applies the aggregate byte budget newest first and reports byte truncation", async () => {
    const capsule = podsCapsule(1, async () => "2026-10-25T10:00:00Z aaaa\n2026-10-25T10:00:01Z bbbb\n2026-10-25T10:00:02Z cccc\n");
    const result = await capsule.service.logs({ id: "svc", bounds: { maxBytes: 9 } });
    expect(result.logs.map((entry) => entry.message)).toEqual(["bbbb", "cccc"]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "bytes", limit: 9, capturedBytes: 8, capturedRecords: 2 });
  });

  it("reports record truncation when maxRecords, not the caller limit, cut the result", async () => {
    const capsule = podsCapsule(3, async ({ name }) => `2026-10-25T10:00:0${name.slice(-1)}Z from ${name}\n`);
    const capped = await capsule.service.logs({ id: "svc", bounds: { maxRecords: 2 } });
    expect(capped.logs.map((entry) => entry.message)).toEqual(["from pod-01", "from pod-02"]);
    expect(capped.truncation).toMatchObject({ truncated: true, reason: "records", limit: 2 });
    const page = await capsule.service.logs({ id: "svc", limit: 2 });
    expect(page.truncation?.truncated).toBe(false);
  });

  it("drops a line cut by the server byte cap and reports it", async () => {
    const capsule = podsCapsule(1, async ({ limitBytes }) => `2026-10-25T10:00:00Z whole\n2026-10-25T10:00:01Z cut-mid`.slice(0, limitBytes));
    const result = await capsule.service.logs({ id: "svc", bounds: { maxBytes: 40 } });
    expect(result.logs.map((entry) => entry.message)).toEqual(["whole"]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "bytes" });
  });

  it("stops waiting at the client deadline and returns what arrived, marked as deadline truncation", async () => {
    const capsule = podsCapsule(2, ({ name }) => (name === "pod-00" ? new Promise<string>(() => undefined) : Promise.resolve("2026-10-25T10:00:00Z fast\n")));
    const started = Date.now();
    const result = await capsule.service.logs({ id: "svc", bounds: { deadlineMs: 50 } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.logs.map((entry) => entry.message)).toEqual(["fast"]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 50 });
  });

  it("throws CaptureLimitError instead of truncating when overflow is error", async () => {
    const capsule = podsCapsule(1, async () => "2026-10-25T10:00:00Z aaaa\n2026-10-25T10:00:01Z bbbb\n");
    await expect(capsule.service.logs({ id: "svc", bounds: { maxBytes: 4, overflow: "error" } })).rejects.toBeInstanceOf(CaptureLimitError);
  });

  it("rejects invalid bounds before listing pods", async () => {
    const lists: unknown[] = [];
    const capsule = podsCapsule(1, async () => "", lists);
    await expect(capsule.service.logs({ id: "svc", bounds: { concurrency: 0 } })).rejects.toBeInstanceOf(RangeError);
    expect(lists).toEqual([]);
  });
});
