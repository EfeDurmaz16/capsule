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
  // Answers like kubelet: tailLines selects the last N lines, then limitBytes counts forward from the
  // start of that tail, so a cut keeps the OLDEST part of the tail.
  function kubeletLog(lines: string[], reads: LogRead[] = []) {
    return async (input: LogRead): Promise<string> => {
      reads.push(input);
      const tail = input.tailLines === undefined ? lines : lines.slice(-input.tailLines);
      const text = tail.map((line) => `${line}\n`).join("");
      return input.limitBytes === undefined ? text : new TextDecoder().decode(new TextEncoder().encode(text).slice(0, input.limitBytes));
    };
  }

  const stamp = (day: number, index: number) =>
    `2026-10-${String(day).padStart(2, "0")}T${String(Math.floor(index / 3600) % 24).padStart(2, "0")}:${String(Math.floor(index / 60) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`;

  it("never reports an until query as complete when the bounded tail could not reach the matching lines", async () => {
    const yesterday = Array.from({ length: 50 }, (_, index) => `${stamp(24, index)} old ${index}`);
    const today = Array.from({ length: 200 }, (_, index) => `${stamp(25, index)} new ${index}`);
    const capsule = podsCapsule(1, kubeletLog([...yesterday, ...today]));
    const until = "2026-10-24T23:59:59Z";
    for (const request of [{ bounds: { maxRecords: 100 } }, { limit: 20 }]) {
      const result = await capsule.service.logs({ id: "svc", until, ...request });
      expect(result.logs).toEqual([]);
      expect(result.truncation).toMatchObject({ truncated: true, reason: "records" });
    }

    // When the tail reaches back past `until`, the matching lines are returned and nothing is flagged.
    const short = podsCapsule(1, kubeletLog([...yesterday, ...today.slice(0, 20)]));
    const complete = await short.service.logs({ id: "svc", until, bounds: { maxRecords: 100 } });
    expect(complete.logs.map((entry) => entry.message)).toEqual(yesterday.map((_, index) => `old ${index}`));
    expect(complete.truncation?.truncated).toBe(false);
  });

  it("keeps the newest lines when the server byte cap cuts a tail, with every read bounded by maxBytes", async () => {
    const lines = Array.from({ length: 2050 }, (_, index) => `${stamp(25, index)} new ${index}`);
    const reads: LogRead[] = [];
    const capsule = podsCapsule(1, kubeletLog(lines, reads));
    const result = await capsule.service.logs({ id: "svc", bounds: { maxBytes: 4096 } });
    expect(result.logs.at(-1)?.message).toBe("new 2049");
    const messages = result.logs.map((entry) => entry.message);
    expect(messages).toEqual(lines.slice(-messages.length).map((_, index) => `new ${2050 - messages.length + index}`));
    expect(result.truncation).toMatchObject({ truncated: true, reason: "bytes", limit: 4096 });
    expect(reads.every((read) => read.limitBytes === 4096)).toBe(true);
    expect(reads.length).toBeLessThanOrEqual(20);
  });
});
