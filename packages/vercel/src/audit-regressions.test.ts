// Audit regressions for the M1 campaign (Vercel). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake returning synthetic
// bodies; no Vercel API is contacted.
import { describe, expect, it } from "vitest";
import { Capsule, ProviderRetryableError } from "@capsule-sdk/core";
import { VercelClient, vercel } from "./index.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("M1 audit regressions: vercel", () => {
  it("EDGE-02: a never-closing runtime log body settles at the limit and cancels the body", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        streamController.enqueue(new TextEncoder().encode(`${JSON.stringify({ message: "one", timestampInMs: 1 })}\n`));
      },
      cancel() {
        cancelled = true;
      }
    });
    const capsule = new Capsule({ adapter: vercel({ token: "fake", projectId: "prj_audit", fetch: async () => new Response(body) }) });
    try {
      const outcome = await Promise.race([
        capsule.edge.logs({ id: "dpl_audit", providerOptions: { api: "runtime" }, limit: 1 }).then(
          () => "settled",
          () => "settled"
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("still-pending"), 1500))
      ]);
      expect(outcome).toBe("settled");
      expect(cancelled).toBe(true);
    } finally {
      try {
        controller.close();
      } catch {
        // Already cancelled or closed by a bounded reader.
      }
    }
  });

  it("EDGE-03: since/until/limit are honored while reading runtime logs, or the request is rejected", async () => {
    const urls: string[] = [];
    const capsule = new Capsule({
      adapter: vercel({
        token: "fake",
        projectId: "prj_audit",
        fetch: async (url) => {
          urls.push(String(url));
          return json([
            { message: "old", timestampInMs: 1 },
            { message: "new", timestampInMs: 2 }
          ]);
        }
      })
    });
    const outcome = await capsule.edge
      .logs({ id: "dpl_audit", providerOptions: { api: "runtime" }, since: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", limit: 1 })
      .then(
        (result) => result,
        () => undefined
      );
    if (outcome === undefined) return;
    expect(outcome.logs.length).toBeLessThanOrEqual(1);
    const since = Date.parse("2026-01-01T00:00:00Z");
    expect(outcome.logs.every((entry) => Date.parse(entry.timestamp) >= since)).toBe(true);
  });

  it("EDGE-05b: an HTML 503 keeps the HTTP status and retry category instead of a SyntaxError", async () => {
    const client = new VercelClient({
      token: "fake",
      fetch: async () => new Response("<html>maintenance</html>", { status: 503, headers: { "content-type": "text/html", "retry-after": "5" } })
    });
    const error = await client.getDeployment("dpl_audit").then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ProviderRetryableError);
  });

  it("EDGE-05b guard: a malformed successful JSON body is still rejected", async () => {
    const client = new VercelClient({
      token: "fake",
      fetch: async () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(client.getDeployment("dpl_audit")).rejects.toThrow();
  });
});
