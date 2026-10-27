// GAP-09: bounded, status-first ARM HTTP handling. fetch is an injected fake; no ARM endpoint is contacted.
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, ProviderRetryableError, UnknownOutcomeError } from "@capsule-sdk/core";
import { AzureContainerAppsClient, azureContainerApps } from "./index.js";

const clientOptions = { accessToken: "fake", subscriptionId: "sub-1", resourceGroupName: "rg-1" };
const path = "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/api?api-version=2025-07-01";

function endlessBody(counter: { pulls: number }, status: number): Response {
  const chunk = new TextEncoder().encode("x".repeat(1024));
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        counter.pulls += 1;
        controller.enqueue(chunk);
      }
    }),
    { status }
  );
}

function stalledFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
}

describe("azure container apps HTTP handling (GAP-09)", () => {
  it("classifies a gateway HTML 502 by status instead of failing on JSON.parse", async () => {
    const client = new AzureContainerAppsClient({ ...clientOptions, fetch: async () => new Response("<html>Bad Gateway</html>", { status: 502 }) });
    const error = await client.request({ path }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as AdapterExecutionError).cause).toMatchObject({ status: 502 });
  });

  it("reads a bounded prefix of an endless error body and an oversized success body", async () => {
    const errorCounter = { pulls: 0 };
    const failing = new AzureContainerAppsClient({ ...clientOptions, fetch: async () => endlessBody(errorCounter, 503) });
    await expect(failing.request({ path })).rejects.toBeInstanceOf(ProviderRetryableError);
    expect(errorCounter.pulls).toBeLessThan(200);

    const okCounter = { pulls: 0 };
    const large = new AzureContainerAppsClient({ ...clientOptions, maxResponseBytes: 4096, fetch: async () => endlessBody(okCounter, 200) });
    await expect(large.request({ path })).rejects.toThrow(/exceeded 4096 bytes/);
    expect(okCounter.pulls).toBeLessThan(20);
  });

  it("reports a 200 body that is not JSON with its status", async () => {
    const client = new AzureContainerAppsClient({ ...clientOptions, fetch: async () => new Response("not json", { status: 200 }) });
    const error = await client.request({ path }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).cause).toMatchObject({ status: 200 });
  });

  it("keeps the status and polling headers of an accepted request", async () => {
    const client = new AzureContainerAppsClient({
      ...clientOptions,
      fetch: async () =>
        new Response(null, {
          status: 202,
          headers: { location: "https://management.azure.com/loc", "azure-asyncoperation": "https://management.azure.com/async", "retry-after": "3" }
        })
    });
    await expect(client.send({ method: "DELETE", path })).resolves.toEqual({
      status: 202,
      data: undefined,
      locationUrl: "https://management.azure.com/loc",
      asyncOperationUrl: "https://management.azure.com/async",
      retryAfterMs: 3000
    });
  });

  it("bounds a stalled read as retryable and a stalled mutation as an unknown outcome", async () => {
    const client = new AzureContainerAppsClient({ ...clientOptions, requestTimeoutMs: 30, fetch: stalledFetch() });
    await expect(client.request({ path })).rejects.toBeInstanceOf(ProviderRetryableError);
    const capsule = new Capsule({
      adapter: azureContainerApps({ ...clientOptions, location: "westeurope", environmentId: "env", requestTimeoutMs: 30, fetch: stalledFetch() })
    });
    const error = await capsule.service.deploy({ name: "api", image: "i" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
  });
});
