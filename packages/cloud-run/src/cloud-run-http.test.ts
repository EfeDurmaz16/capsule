// GAP-09 and PERF-06: bounded, status-first HTTP handling and Google auth reuse in the Cloud Run client.
// fetch is an injected fake and GoogleAuth.getClient is stubbed; no Google endpoint is contacted.
import { GoogleAuth } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterExecutionError, Capsule, PendingOperationError, ProviderRetryableError, UnknownOutcomeError } from "@capsule-sdk/core";
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

// google-auth-library's getRequestHeaders takes no signal, so an ADC token refresh cannot be cancelled.
// The request that needs the token still ends at its timeout or the observation deadline, and a token
// that arrives later sends nothing.
describe("cloud-run token refresh bounds", () => {
  function hungAuth(answered = 0) {
    const release: Array<() => void> = [];
    let calls = 0;
    vi.spyOn(GoogleAuth.prototype, "getClient").mockImplementation((async () => ({
      getRequestHeaders: () => {
        calls += 1;
        const headers = new Headers({ authorization: "Bearer synthetic-token" });
        if (calls <= answered) return Promise.resolve(headers);
        return new Promise<Headers>((resolve) => release.push(() => resolve(headers)));
      }
    })) as never);
    return { releaseAll: () => release.splice(0).forEach((resolve) => resolve()) };
  }

  function recordingFetch(urls: string[]): typeof fetch {
    return (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ name: "projects/p/locations/l/operations/delete", done: false }), { status: 200 });
    }) as typeof fetch;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it.each([
    { call: "a read", run: (capsule: Capsule) => capsule.job.status({ id: execution }) },
    { call: "a mutation", run: (capsule: Capsule) => capsule.job.run({ name: "j", image: "i" }) }
  ])("ends $call at the request timeout as retryable when the token refresh hangs, and sends nothing later", async ({ run }) => {
    const auth = hungAuth();
    const urls: string[] = [];
    const capsule = new Capsule({ adapter: cloudRun({ projectId: "p", location: "l", requestTimeoutMs: 30, fetch: recordingFetch(urls) }) });
    const error = await run(capsule).catch((caught: unknown) => caught);
    // Nothing was sent, so even a mutation is safe to retry rather than an unknown outcome.
    expect(error).toBeInstanceOf(ProviderRetryableError);
    auth.releaseAll();
    await settle();
    expect(urls).toEqual([]);
  });

  it("ends a delete observation at its deadline when the token refresh hangs, and sends no wait later", async () => {
    const auth = hungAuth(1);
    const urls: string[] = [];
    const capsule = new Capsule({
      adapter: cloudRun({ projectId: "p", location: "l", operationDeadlineMs: 40, operationPollIntervalMs: 1, fetch: recordingFetch(urls) })
    });
    const error = await capsule.service.delete({ id: "s" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    auth.releaseAll();
    await settle();
    expect(urls).toEqual(["https://run.googleapis.com/v2/projects/p/locations/l/services/s"]);
  });
});
