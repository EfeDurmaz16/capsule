// Audit regressions for the M1 campaign (Cloud Run). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake returning
// Operation-shaped JSON; no Google API is contacted.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { cloudRun } from "./index.js";

const execution = "projects/p/locations/l/jobs/j/executions/e";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Pending lifecycle (CD-DELETE): a still-pending promise has not claimed a terminal state, so a bounded
// wait that has not settled within the window is acceptable; a resolved fake terminal state is not.
async function settleOrPending<T>(
  promise: Promise<T>,
  ms = 1000
): Promise<{ state: "resolved"; value: T } | { state: "rejected"; error: unknown } | { state: "pending" }> {
  return await Promise.race([
    promise.then(
      (value) => ({ state: "resolved" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error })
    ),
    new Promise<{ state: "pending" }>((resolve) => setTimeout(() => resolve({ state: "pending" }), ms))
  ]);
}

describe("M1 audit regressions: cloud-run", () => {
  it.fails("SVC-03: cancel keeps the original Execution identity instead of the Operation name", async () => {
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        fetch: async () => json({ name: "projects/p/locations/l/operations/cancel", done: false })
      })
    });
    expect((await capsule.job.cancel({ id: execution })).id).toBe(execution);
  });

  it.fails("SVC-04: a pending delete Operation never produces deleted", async () => {
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        fetch: async () => json({ name: "projects/p/locations/l/operations/delete", done: false })
      })
    });
    const outcome = await settleOrPending(capsule.service.delete({ id: "s" }));
    expect(outcome.state === "resolved" && outcome.value.status === "deleted").toBe(false);
  });

  it.fails("SVC-07b: a pending run never reports the Job resource name as the execution id", async () => {
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        waitForOperations: false,
        fetch: async () => json({ name: "projects/p/locations/l/operations/run", done: false })
      })
    });
    const outcome = await settleOrPending(capsule.job.run({ name: "j", image: "i" }));
    expect(outcome.state === "resolved" && outcome.value.id === "projects/p/locations/l/jobs/j").toBe(false);
  });

  it("SVC-02: a command healthcheck is rejected before any API request and never replaces the entrypoint", async () => {
    let requests = 0;
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        waitForOperations: false,
        fetch: async () => {
          requests += 1;
          return json({ name: "op", done: false });
        }
      })
    });
    const outcome = await capsule.service.deploy({ name: "app", image: "i", healthcheck: { command: ["curl", "localhost/health"] } }).then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
    expect(requests).toBe(0);
  });

  it.fails("SVC-07a: a failed create Operation never proceeds to :run", async () => {
    const urls: string[] = [];
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        fetch: async (url) => {
          urls.push(String(url));
          return String(url).includes(":run")
            ? json({ name: "run", done: true, response: { name: execution, completionStatus: "EXECUTION_SUCCEEDED" } })
            : json({ name: "create", done: true, error: { code: 3, message: "invalid template" } });
        }
      })
    });
    const outcome = await capsule.job.run({ name: "j", image: "i" }).then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
    expect(urls.some((url) => url.includes(":run"))).toBe(false);
  });

  it("SVC-02: a command healthcheck never replaces the entrypoint on update, and path probes still work", async () => {
    const bodies: unknown[] = [];
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        waitForOperations: false,
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body ?? "{}")));
          return json({ name: "op", done: false });
        }
      })
    });
    await expect(capsule.service.update({ id: "app", image: "i", healthcheck: { command: "curl localhost" } })).rejects.toThrow(/healthcheck.command/);
    expect(bodies).toEqual([]);
    await capsule.service.deploy({ name: "app", image: "i", ports: [{ port: 8080 }], healthcheck: { path: "/healthz" } });
    const container = (bodies[0] as { template: { containers: Array<Record<string, unknown>> } }).template.containers[0]!;
    expect(container.command).toBeUndefined();
    expect(container.args).toBeUndefined();
    expect(container.startupProbe).toEqual({ httpGet: { path: "/healthz" } });
  });
});
