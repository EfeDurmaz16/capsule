// EDGE-05c / PERF-07: status-first error handling, response byte budget and request deadline for the
// Fly client. fetch is an injected fake; no Machines API is contacted.
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, CaptureLimitError, ProviderRetryableError, UnknownOutcomeError } from "@capsule-sdk/core";
import { FlyClient } from "./index.js";

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

describe("fly client HTTP bounds", () => {
  it("keeps status, Retry-After and retry category for an HTML 503 without echoing the page", async () => {
    const client = new FlyClient({
      apiToken: "fake",
      fetch: async () => new Response("<html>maintenance secret-ish</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "5" } })
    });
    const error = await client.request({ path: "/v1/apps/a/machines" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as ProviderRetryableError).cause).toMatchObject({
      status: 503,
      contentType: "text/html",
      providerError: { category: "retryable", status: 503, retryAfterMs: 5000 }
    });
    expect(JSON.stringify((error as ProviderRetryableError).cause)).not.toContain("maintenance");
  });

  it("keeps the JSON error message for a JSON error body", async () => {
    const client = new FlyClient({
      apiToken: "fake",
      fetch: async () => new Response(JSON.stringify({ error: "machine not found" }), { status: 404 })
    });
    await expect(client.request({ path: "/v1/apps/a/machines/m" })).rejects.toThrow("machine not found");
  });

  it("rejects a malformed successful body with a typed error", async () => {
    const client = new FlyClient({ apiToken: "fake", fetch: async () => new Response("{not json", { status: 200 }) });
    const error = await client.request({ path: "/x" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as Error).message).toContain("malformed JSON body with status 200");
  });

  it("rejects an oversized successful body after reading at most the budget and cancels the rest", async () => {
    const { body, state } = endlessBody();
    const client = new FlyClient({ apiToken: "fake", maxResponseBytes: 4096, fetch: async () => new Response(body, { status: 200 }) });
    const error = await client.request({ path: "/x" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CaptureLimitError);
    expect((error as CaptureLimitError).truncation).toMatchObject({ truncated: true, reason: "bytes", limit: 4096 });
    expect(state.cancelled).toBe(true);
    expect(state.pulledBytes).toBeLessThan(64 * 1024);
  });

  it("rejects before reading when content-length already exceeds the budget", async () => {
    const { body, state } = endlessBody();
    const client = new FlyClient({
      apiToken: "fake",
      maxResponseBytes: 10,
      fetch: async () => new Response(body, { status: 200, headers: { "content-length": "1000000" } })
    });
    await expect(client.request({ path: "/x" })).rejects.toBeInstanceOf(CaptureLimitError);
    expect(state.cancelled).toBe(true);
  });

  it("cancels a never-ending GET body at the deadline and reports a retryable timeout", async () => {
    const { body, state } = idleBody();
    const client = new FlyClient({ apiToken: "fake", requestTimeoutMs: 50, fetch: async () => new Response(body, { status: 200 }) });
    const error = await client.request({ path: "/v1/apps/a/machines/m" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as Error).message).toContain("did not complete within 50ms");
    expect(state.cancelled).toBe(true);
  });

  it("reports a mutation whose response never arrives as an unknown outcome, not a retryable error", async () => {
    let signal: AbortSignal | undefined;
    const client = new FlyClient({
      apiToken: "fake",
      requestTimeoutMs: 50,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return await new Promise<Response>(() => undefined);
      }) as typeof fetch
    });
    const error = await client.request({ method: "POST", path: "/v1/apps/a/machines?token=never-logged", body: {} }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).retrySafe).toBe(false);
    expect((error as UnknownOutcomeError).operation).toBe("POST /v1/apps/a/machines");
    expect((error as Error).message).not.toContain("never-logged");
    expect(signal?.aborted).toBe(true);
  });

  it("rejects invalid limits before any request", () => {
    expect(() => new FlyClient({ apiToken: "fake", requestTimeoutMs: 0 })).toThrow(RangeError);
    expect(() => new FlyClient({ apiToken: "fake", maxResponseBytes: 1.5 })).toThrow(RangeError);
  });
});
