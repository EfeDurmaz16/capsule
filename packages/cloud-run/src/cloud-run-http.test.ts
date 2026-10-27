// GAP-09 and PERF-06: bounded, status-first HTTP handling and Google auth reuse in the Cloud Run client.
// fetch is an injected fake and GoogleAuth.getClient is stubbed; no Google endpoint is contacted.
import { GoogleAuth } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterExecutionError, Capsule, ProviderRetryableError, UnknownOutcomeError } from "@capsule-sdk/core";
import { CloudRunClient, cloudRun } from "./index.js";

const execution = "projects/p/locations/l/jobs/j/executions/e";

function endlessBody(counter: { pulls: number }, status = 503): Response {
  const chunk = new TextEncoder().encode("x".repeat(1024));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulls += 1;
      controller.enqueue(chunk);
    }
  });
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

function stalledFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cloud-run HTTP handling (GAP-09)", () => {
  it("classifies a gateway HTML 503 by status instead of failing on JSON.parse", async () => {
    const client = new CloudRunClient({
      projectId: "p",
      location: "l",
      accessToken: "fake",
      fetch: async () => new Response("<html>Service Unavailable</html>", { status: 503, headers: { "content-type": "text/html" } })
    });
    const error = await client.getExecution(execution).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as AdapterExecutionError).cause).toMatchObject({ status: 503, providerError: { status: 503, retryable: true } });
  });

  it("reads at most a bounded prefix of an endless error body and cancels the rest", async () => {
    const counter = { pulls: 0 };
    const client = new CloudRunClient({ projectId: "p", location: "l", accessToken: "fake", fetch: async () => endlessBody(counter) });
    await expect(client.getExecution(execution)).rejects.toBeInstanceOf(ProviderRetryableError);
    expect(counter.pulls).toBeLessThan(200);
  });

  it("rejects an oversized success body instead of buffering it", async () => {
    const counter = { pulls: 0 };
    const client = new CloudRunClient({
      projectId: "p",
      location: "l",
      accessToken: "fake",
      maxResponseBytes: 4096,
      fetch: async () => endlessBody(counter, 200)
    });
    await expect(client.getExecution(execution)).rejects.toThrow(/exceeded 4096 bytes/);
    expect(counter.pulls).toBeLessThan(20);
  });

  it("reports a 200 body that is not JSON with its status", async () => {
    const client = new CloudRunClient({ projectId: "p", location: "l", accessToken: "fake", fetch: async () => new Response("not json", { status: 200 }) });
    const error = await client.getExecution(execution).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).cause).toMatchObject({ status: 200 });
  });

  it("bounds a stalled read with the request timeout and marks it retryable", async () => {
    const client = new CloudRunClient({ projectId: "p", location: "l", accessToken: "fake", requestTimeoutMs: 30, fetch: stalledFetch() });
    const started = Date.now();
    await expect(client.getExecution(execution)).rejects.toBeInstanceOf(ProviderRetryableError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reports a stalled mutation as an unknown outcome, not as a retryable failure", async () => {
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "p", location: "l", accessToken: "fake", requestTimeoutMs: 30, fetch: stalledFetch() }) });
    const error = await capsule.job.run({ name: "j", image: "i" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect(error).toMatchObject({ retrySafe: false });
  });
});

describe("cloud-run auth reuse (PERF-06)", () => {
  function stubAuth(options: { failFirst?: boolean } = {}) {
    let calls = 0;
    const getRequestHeaders = vi.fn(async () => new Headers({ authorization: "Bearer synthetic-token" }));
    const getClient = vi.spyOn(GoogleAuth.prototype, "getClient").mockImplementation((async () => {
      calls += 1;
      if (options.failFirst && calls === 1) throw new Error("metadata server not reachable yet");
      return { getRequestHeaders };
    }) as never);
    return { getClient, getRequestHeaders };
  }

  const okFetch = (async () => new Response(JSON.stringify({ name: execution, completionStatus: "EXECUTION_RUNNING" }), { status: 200 })) as typeof fetch;

  it("resolves the Google auth client once per adapter and asks it for fresh headers on every request", async () => {
    const { getClient, getRequestHeaders } = stubAuth();
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "p", location: "l", fetch: okFetch }) });
    for (let index = 0; index < 3; index += 1) await capsule.job.status({ id: execution });
    expect(getClient).toHaveBeenCalledTimes(1);
    // The auth library refreshes an expired token inside getRequestHeaders, so it must run per request.
    expect(getRequestHeaders).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed auth client lookup", async () => {
    const { getClient } = stubAuth({ failFirst: true });
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "p", location: "l", fetch: okFetch }) });
    await expect(capsule.job.status({ id: execution })).rejects.toThrow("metadata server not reachable yet");
    await expect(capsule.job.status({ id: execution })).resolves.toMatchObject({ status: "running" });
    expect(getClient).toHaveBeenCalledTimes(2);
  });
});
