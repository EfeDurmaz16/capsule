// EDGE-02 / EDGE-03 / PERF-04: bounded incremental reads of the Vercel runtime logs stream. Bodies are
// synthetic ReadableStreams; no Vercel API is contacted.
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, CaptureLimitError, ProviderRetryableError } from "@capsule-sdk/core";
import { VercelClient, vercel } from "./index.js";

const encoder = new TextEncoder();
const line = (record: unknown) => `${JSON.stringify(record)}\n`;

/** A stream that produces chunks on demand forever, counting what the reader pulled. */
function endless(next: (index: number) => string) {
  const state = { cancelled: false, pulledBytes: 0, pulls: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const bytes = encoder.encode(next(state.pulls));
      state.pulls += 1;
      state.pulledBytes += bytes.byteLength;
      controller.enqueue(bytes);
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return { body, state };
}

/** A stream that emits the given chunks and then stays open without data. */
function openAfter(chunks: Array<string | Uint8Array>) {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return { body, state };
}

function client(body: ReadableStream<Uint8Array>, urls: string[] = []) {
  return new VercelClient({
    token: "fake",
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(body);
    }
  });
}

describe("vercel runtime logs bounded reader", () => {
  it("requests the documented line framing", async () => {
    const urls: string[] = [];
    await client(openAfter([line({ message: "a", timestampInMs: 1 })]).body, urls).readRuntimeLogs({
      projectId: "prj",
      deploymentId: "dpl",
      bounds: { maxRecords: 1 }
    });
    expect(urls[0]).toBe("https://api.vercel.com/v1/projects/prj/deployments/dpl/runtime-logs?format=lines");
  });

  it("stops an endless stream at the record cap and cancels the body", async () => {
    const { body, state } = endless((index) => line({ message: `m${index}`, timestampInMs: index }));
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl", bounds: { maxRecords: 5 } });
    expect(read.logs.map((log) => log.message)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(read.truncation).toMatchObject({ truncated: true, reason: "records", limit: 5, capturedRecords: 5 });
    expect(read.endedBy).toBe("bounds");
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(10);
  });

  it("stops at the byte cap; pulled bytes stay bounded however much the stream would emit", async () => {
    const { body, state } = endless((index) => line({ message: "x".repeat(200), timestampInMs: index }));
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl", bounds: { maxBytes: 4096 } });
    expect(read.truncation).toMatchObject({ truncated: true, reason: "bytes", limit: 4096 });
    expect(read.truncation.capturedBytes).toBeLessThanOrEqual(4096);
    expect(read.logs.length).toBeGreaterThan(0);
    expect(state.cancelled).toBe(true);
    expect(state.pulledBytes).toBeLessThan(4096 + 1024);
  });

  it("stops a single endless line without a newline at the byte cap instead of buffering it", async () => {
    const { body, state } = endless(() => "y".repeat(1024));
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl", bounds: { maxBytes: 8192 } });
    expect(read.logs).toEqual([]);
    expect(read.truncation).toMatchObject({ truncated: true, reason: "bytes" });
    expect(state.cancelled).toBe(true);
    // The stream may prefetch one chunk beyond the one that crossed the cap.
    expect(state.pulledBytes).toBeLessThanOrEqual(8192 + 2 * 1024);
  });

  it("settles an idle open stream at the deadline with what it has and cancels the body", async () => {
    const { body, state } = openAfter([line({ message: "only", timestampInMs: 1 })]);
    const startedAt = Date.now();
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl", bounds: { deadlineMs: 50 } });
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(read.logs.map((log) => log.message)).toEqual(["only"]);
    expect(read.truncation).toMatchObject({ truncated: true, reason: "deadline", limit: 50 });
    expect(state.cancelled).toBe(true);
  });

  it("throws CaptureLimitError at the deadline when overflow is error", async () => {
    const { body } = openAfter([]);
    await expect(client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl", bounds: { deadlineMs: 30, overflow: "error" } })).rejects.toBeInstanceOf(
      CaptureLimitError
    );
  });

  it("reassembles records split across chunks, including a split multi-byte character", async () => {
    const full = encoder.encode(line({ message: "héllo wörld", timestampInMs: 7 }) + line({ message: "second", timestampInMs: 8 }));
    const splitAt = [3, 13, 14, 30];
    const chunks: Uint8Array[] = [];
    let previous = 0;
    for (const index of [...splitAt, full.byteLength]) {
      chunks.push(full.subarray(previous, index));
      previous = index;
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    });
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl" });
    expect(read.logs.map((log) => log.message)).toEqual(["héllo wörld", "second"]);
    expect(read.truncation.truncated).toBe(false);
    expect(read.endedBy).toBe("end-of-stream");
  });

  it("skips and counts malformed records without guessing", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`${line({ message: "ok", timestampInMs: 1 })}{"message": broken\n42\n${line({ message: "after", timestampInMs: 2 })}`)
        );
        controller.close();
      }
    });
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl" });
    expect(read.logs.map((log) => log.message)).toEqual(["ok", "after"]);
    expect(read.malformedRecords).toBe(2);
  });

  it("stops at the Vercel runtime-limit delimiter record", async () => {
    const { body, state } = openAfter([
      line({ message: "before", timestampInMs: 1 }),
      line({ rowId: "", level: "error", source: "delimiter", message: "limit reached" }),
      line({ message: "never", timestampInMs: 3 })
    ]);
    const read = await client(body).readRuntimeLogs({ projectId: "prj", deploymentId: "dpl" });
    expect(read.logs.map((log) => log.message)).toEqual(["before"]);
    expect(read.endedBy).toBe("provider-limit");
    expect(state.cancelled).toBe(true);
  });

  it("keeps the HTTP status and retry category for an HTML error on the runtime endpoint", async () => {
    const vercelClient = new VercelClient({
      token: "fake",
      fetch: async () => new Response("<html>busy</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "2" } })
    });
    const error = await vercelClient.readRuntimeLogs({ projectId: "prj", deploymentId: "dpl" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as ProviderRetryableError).cause).toMatchObject({ status: 503, providerError: { retryAfterMs: 2000 } });
  });
});

describe("vercel edge.logs runtime constraints", () => {
  it("rejects since/until for runtime logs before any request", async () => {
    const urls: string[] = [];
    const capsule = new Capsule({
      adapter: vercel({
        token: "fake",
        projectId: "prj",
        fetch: async (url) => {
          urls.push(String(url));
          return new Response("");
        }
      })
    });
    await expect(capsule.edge.logs({ id: "dpl", providerOptions: { api: "runtime" }, since: "2026-01-01T00:00:00Z" })).rejects.toBeInstanceOf(
      AdapterExecutionError
    );
    await expect(capsule.edge.logs({ id: "dpl", providerOptions: { api: "runtime" }, until: "2026-01-02T00:00:00Z" })).rejects.toThrow(
      "since and until are not supported"
    );
    expect(urls).toEqual([]);
  });

  it("enforces limit while reading and reports truncation and applied constraints", async () => {
    const { body, state } = endless((index) => line({ message: `m${index}`, timestampInMs: index }));
    const capsule = new Capsule({ adapter: vercel({ token: "fake", projectId: "prj", fetch: async () => new Response(body) }), receipts: true });
    const result = await capsule.edge.logs({ id: "dpl", providerOptions: { api: "runtime" }, limit: 2 });
    expect(result.logs.map((entry) => entry.message)).toEqual(["m0", "m1"]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "records", limit: 2 });
    expect(result.receipt?.metadata).toMatchObject({ appliedConstraints: { limit: 2, enforcedBy: "capsule" } });
    expect(state.cancelled).toBe(true);
  });

  it("applies caller bounds to runtime logs", async () => {
    const { body, state } = openAfter([]);
    const capsule = new Capsule({ adapter: vercel({ token: "fake", projectId: "prj", fetch: async () => new Response(body) }) });
    const result = await capsule.edge.logs({ id: "dpl", providerOptions: { api: "runtime" }, bounds: { deadlineMs: 30 } });
    expect(result.logs).toEqual([]);
    expect(result.truncation).toMatchObject({ truncated: true, reason: "deadline" });
    expect(state.cancelled).toBe(true);
  });
});

describe("runtime log reader lock", () => {
  it("leaves the read body locked instead of releasing the reader", async () => {
    // releaseLock in Node builds an "invalid state" error whose first use creates a vm context (about 1 ms
    // per process), which made the first runtime log read slower than at 7d3a28a.
    const responses: Response[] = [];
    const client = new VercelClient({
      token: "test-token",
      fetch: async () => {
        const response = new Response(`${line({ id: "a", message: "one" })}${line({ id: "b", message: "two" })}`, { status: 200 });
        responses.push(response);
        return response;
      }
    });
    const read = await client.readRuntimeLogs({ projectId: "prj", deploymentId: "dpl" });
    expect(read.logs.map((log) => log.id)).toEqual(["a", "b"]);
    expect(responses[0]?.body?.locked).toBe(true);
  });
});
