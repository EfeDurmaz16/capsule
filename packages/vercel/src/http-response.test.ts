// EDGE-05b / PERF-07: status-first error handling, response byte budget and request deadline for the
// Vercel client. fetch is an injected fake; no Vercel API is contacted.
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, CaptureLimitError, ProviderRetryableError, UnknownOutcomeError } from "@capsule-sdk/core";
import { VercelClient } from "./index.js";

function endlessBody(chunk = "x".repeat(1024)) {
  const state = { cancelled: false, pulledBytes: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const bytes = new TextEncoder().encode(chunk);
      state.pulledBytes += bytes.byteLength;
      controller.enqueue(bytes);
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return { body, state };
}

function idleBody() {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return { body, state };
}

describe("vercel client HTTP bounds", () => {
  it("keeps status, Retry-After and retry category for an HTML 503 without echoing the page", async () => {
    const client = new VercelClient({
      token: "fake",
      fetch: async () => new Response("<html>maintenance secret-ish</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "5" } })
    });
    const error = await client.getDeployment("dpl").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as ProviderRetryableError).cause).toMatchObject({
      status: 503,
      contentType: "text/html",
      providerError: { category: "retryable", status: 503, retryAfterMs: 5000 }
    });
    expect(JSON.stringify((error as ProviderRetryableError).cause)).not.toContain("maintenance");
  });

  it("keeps the JSON error message for a JSON error body", async () => {
    const client = new VercelClient({
      token: "fake",
      fetch: async () => new Response(JSON.stringify({ error: { code: "not_found", message: "deployment not found" } }), { status: 404 })
    });
    await expect(client.getDeployment("dpl")).rejects.toThrow("deployment not found");
  });

  it("rejects a malformed successful body with a typed error", async () => {
    const client = new VercelClient({ token: "fake", fetch: async () => new Response("{not json", { status: 200 }) });
    const error = await client.getDeployment("dpl").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as Error).message).toContain("malformed JSON body with status 200");
  });

  it("rejects an oversized successful body after reading at most the budget and cancels the rest", async () => {
    const { body, state } = endlessBody();
    const client = new VercelClient({ token: "fake", maxResponseBytes: 4096, fetch: async () => new Response(body, { status: 200 }) });
    const error = await client.getDeployment("dpl").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CaptureLimitError);
    expect((error as CaptureLimitError).truncation).toMatchObject({ truncated: true, reason: "bytes", limit: 4096 });
    expect(state.cancelled).toBe(true);
    expect(state.pulledBytes).toBeLessThan(64 * 1024);
  });

  it("rejects before reading when content-length already exceeds the budget", async () => {
    const { body, state } = endlessBody();
    const client = new VercelClient({
      token: "fake",
      maxResponseBytes: 10,
      fetch: async () => new Response(body, { status: 200, headers: { "content-length": "1000000" } })
    });
    await expect(client.getDeployment("dpl")).rejects.toBeInstanceOf(CaptureLimitError);
    expect(state.cancelled).toBe(true);
  });

  it("cancels a never-ending GET body at the deadline and reports a retryable timeout", async () => {
    const { body, state } = idleBody();
    const client = new VercelClient({ token: "fake", requestTimeoutMs: 50, fetch: async () => new Response(body, { status: 200 }) });
    const error = await client.getDeployment("dpl").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as Error).message).toContain("did not complete within 50ms");
    expect(state.cancelled).toBe(true);
  });

  it("reports a mutation whose response never arrives as an unknown outcome, not a retryable error", async () => {
    let signal: AbortSignal | undefined;
    const client = new VercelClient({
      token: "fake",
      teamId: "team_never_logged",
      requestTimeoutMs: 50,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return await new Promise<Response>(() => undefined);
      }) as typeof fetch
    });
    const error = await client.assignAlias("dpl", { alias: "a.example" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).retrySafe).toBe(false);
    expect((error as UnknownOutcomeError).operation).toBe("POST /v2/deployments/dpl/aliases");
    expect((error as Error).message).not.toContain("team_never_logged");
    expect(signal?.aborted).toBe(true);
  });

  it("rejects invalid limits before any request", () => {
    expect(() => new VercelClient({ token: "fake", requestTimeoutMs: 0 })).toThrow(RangeError);
    expect(() => new VercelClient({ token: "fake", maxResponseBytes: 1.5 })).toThrow(RangeError);
  });
});

describe("readCapped reader lock", () => {
  it("leaves the finished body locked instead of releasing the reader", async () => {
    // releaseLock in Node builds an "invalid state" error whose first use creates a vm context (about 1 ms
    // per process); a body that is closed, cancelled or errored has no other reader to release it for.
    const { readCapped } = await import("./http-response.js");
    const finished = new Response("complete body");
    await expect(readCapped(finished, 1024, new AbortController().signal)).resolves.toEqual({ text: "complete body", bytes: 13, overflowed: false });
    expect(finished.body?.locked).toBe(true);
    const capped = new Response("0123456789");
    await expect(readCapped(capped, 4, new AbortController().signal)).resolves.toEqual({ text: "0123", bytes: 4, overflowed: true });
    expect(capped.body?.locked).toBe(true);
  });
});

describe("request timeout longer than a timer can wait", () => {
  it("does not abort after 1 ms when requestTimeoutMs is 2^31 ms or more", async () => {
    // Node fires a setTimeout longer than 2^31 - 1 ms after 1 ms.
    const { fetchWithinLimits } = await import("./http-response.js");
    const response = await fetchWithinLimits({
      provider: "test",
      fetchImpl: (async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response('{"ok":true}', { status: 200 });
      }) as typeof fetch,
      url: "https://api.example.test/v1/ping",
      init: { method: "GET" },
      limits: { requestTimeoutMs: 2 ** 31, maxResponseBytes: 1024 }
    });
    expect(response.status).toBe(200);
  });
});
