// Audit regressions for the M1 campaign (Cloud Run). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. fetch is an injected fake returning
// Operation-shaped JSON; no Google API is contacted.
import { describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, PendingOperationError, UnknownOutcomeError } from "@capsule-sdk/core";
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
  it("SVC-03: cancel keeps the original Execution identity instead of the Operation name", async () => {
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

  it("SVC-04: a pending delete Operation never produces deleted", async () => {
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

  it("SVC-07b: a pending run never reports the Job resource name as the execution id", async () => {
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

  it("SVC-07a: a failed create Operation never proceeds to :run", async () => {
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

  it("SVC-03: a cancel Operation that is not done reports cancelling and keeps the operation as metadata", async () => {
    const capsule = new Capsule({
      adapter: cloudRun({
        projectId: "p",
        location: "l",
        accessToken: "fake",
        fetch: async () => json({ name: "projects/p/locations/l/operations/cancel", done: false, metadata: { name: execution, completionStatus: "EXECUTION_RUNNING" } })
      })
    });
    const cancelled = await capsule.job.cancel({ id: execution });
    expect(cancelled).toMatchObject({ id: execution, status: "cancelling", metadata: { operation: "projects/p/locations/l/operations/cancel" } });
  });

  describe("SVC-04: service.delete reports deleted only for a done operation", () => {
    function deleteCapsule(waitResponses: unknown[], options: { waitForOperations?: boolean; operationDeadlineMs?: number } = {}) {
      const urls: string[] = [];
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: "p",
          location: "l",
          accessToken: "fake",
          operationPollIntervalMs: 1,
          ...options,
          fetch: async (url) => {
            urls.push(String(url));
            if (String(url).endsWith(":wait")) return json(waitResponses.length > 1 ? waitResponses.shift() : waitResponses[0]);
            return json({ name: "projects/p/locations/l/operations/delete", done: false });
          }
        })
      });
      return { capsule, urls };
    }

    it("throws PendingOperationError with the operation locator when waiting is disabled", async () => {
      const { capsule } = deleteCapsule([], { waitForOperations: false });
      const error = await capsule.service.delete({ id: "s" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PendingOperationError);
      expect(error).toMatchObject({ resource: { kind: "service", nativeId: "projects/p/locations/l/services/s", nativeOperationId: "projects/p/locations/l/operations/delete" } });
    });

    it("keeps waiting across best-effort waits that return early and stops at the client deadline", async () => {
      const { capsule, urls } = deleteCapsule([{ name: "projects/p/locations/l/operations/delete", done: false }], { operationDeadlineMs: 60 });
      const error = await capsule.service.delete({ id: "s" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PendingOperationError);
      expect(urls.filter((url) => url.endsWith(":wait")).length).toBeGreaterThan(1);
    });

    it("reports deleted once a later wait returns done", async () => {
      const { capsule } = deleteCapsule([
        { name: "projects/p/locations/l/operations/delete", done: false },
        { name: "projects/p/locations/l/operations/delete", done: true }
      ]);
      await expect(capsule.service.delete({ id: "s" })).resolves.toMatchObject({ status: "deleted" });
    });

    it("keeps a terminal failure as a failure", async () => {
      const { capsule } = deleteCapsule([{ name: "projects/p/locations/l/operations/delete", done: true, error: { code: 9, message: "precondition" } }]);
      await expect(capsule.service.delete({ id: "s" })).rejects.toThrow(/precondition/);
    });
  });

  describe("SVC-07: job creation and run identity", () => {
    it("SVC-07a: a pending create is awaited before :run and a create that never finishes never runs", async () => {
      const urls: string[] = [];
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: "p",
          location: "l",
          accessToken: "fake",
          operationDeadlineMs: 50,
          operationPollIntervalMs: 1,
          fetch: async (url) => {
            urls.push(String(url));
            return json({ name: "projects/p/locations/l/operations/create", done: false });
          }
        })
      });
      const error = await capsule.job.run({ name: "j", image: "i" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PendingOperationError);
      expect(error).toMatchObject({ resource: { kind: "job", nativeId: "projects/p/locations/l/jobs/j" } });
      expect(urls.some((url) => url.includes(":run"))).toBe(false);
    });

    it("SVC-07b: a pending run returns the Execution from the operation metadata", async () => {
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: "p",
          location: "l",
          accessToken: "fake",
          waitForOperations: false,
          fetch: async (url) =>
            String(url).includes(":run")
              ? json({ name: "projects/p/locations/l/operations/run", done: false, metadata: { name: execution, completionStatus: "EXECUTION_RUNNING" } })
              : json({ name: "projects/p/locations/l/operations/create", done: true, response: { name: "projects/p/locations/l/jobs/j" } })
        })
      });
      const run = await capsule.job.run({ name: "j", image: "i" });
      expect(run).toMatchObject({ id: execution, status: "running" });
      expect(run.result).toBeUndefined();
    });

    it("SVC-07b: a pending run with no Execution yet is pending with the run operation locator", async () => {
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: "p",
          location: "l",
          accessToken: "fake",
          waitForOperations: false,
          fetch: async (url) =>
            String(url).includes(":run")
              ? json({ name: "projects/p/locations/l/operations/run", done: false })
              : json({ name: "projects/p/locations/l/operations/create", done: true })
        })
      });
      const error = await capsule.job.run({ name: "j", image: "i" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PendingOperationError);
      expect(error).toMatchObject({ resource: { nativeId: "projects/p/locations/l/jobs/j", nativeOperationId: "projects/p/locations/l/operations/run" } });
    });

    it("SVC-07b: a run that failed to start throws instead of returning a fabricated id", async () => {
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: "p",
          location: "l",
          accessToken: "fake",
          fetch: async (url) =>
            String(url).includes(":run")
              ? json({ name: "projects/p/locations/l/operations/run", done: true, error: { code: 8, message: "quota exceeded" } })
              : json({ name: "projects/p/locations/l/operations/create", done: true })
        })
      });
      const error = await capsule.job.run({ name: "j", image: "i" }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AdapterExecutionError);
      expect(error).not.toBeInstanceOf(UnknownOutcomeError);
      expect((error as Error).message).toMatch(/quota exceeded/);
    });
  });

  describe("GAP-10: resource names are checked against the configured project and location", () => {
    function scopeCapsule(extra: { projectNumber?: string } = {}) {
      const urls: string[] = [];
      const capsule = new Capsule({
        adapter: cloudRun({
          projectId: "p",
          location: "l",
          accessToken: "fake",
          ...extra,
          fetch: async (url) => {
            urls.push(String(url));
            return json({ name: "projects/p/locations/l/services/s", uri: "https://s.example" });
          }
        })
      });
      return { capsule, urls };
    }

    it("rejects full names from another project or location before any request", async () => {
      const { capsule, urls } = scopeCapsule();
      await expect(capsule.service.status({ id: "projects/other/locations/l/services/s" })).rejects.toThrow(/outside the configured scope/);
      await expect(capsule.service.delete({ id: "projects/p/locations/elsewhere/services/s" })).rejects.toThrow(/outside the configured scope/);
      await expect(capsule.job.status({ id: "projects/other/locations/l/jobs/j/executions/e" })).rejects.toThrow(/outside the configured scope/);
      await expect(capsule.job.cancel({ id: "projects/other/locations/l/jobs/j/executions/e" })).rejects.toThrow(/outside the configured scope/);
      await expect(capsule.job.logs({ id: "projects/other/locations/l/jobs/j" })).rejects.toThrow(/outside the configured scope/);
      await expect(capsule.service.logs({ id: "projects/other/locations/l/services/s" })).rejects.toThrow(/outside the configured scope/);
      expect(urls).toEqual([]);
    });

    it("rejects malformed ids and short ids that are not one path segment", async () => {
      const { capsule, urls } = scopeCapsule();
      await expect(capsule.service.status({ id: "s/../../other" })).rejects.toThrow(/single resource name segment/);
      await expect(capsule.service.status({ id: "projects/p/locations/l/jobs/j" })).rejects.toThrow(/not a valid service resource name/);
      await expect(capsule.job.status({ id: "e" })).rejects.toThrow(/full execution resource name/);
      expect(urls).toEqual([]);
    });

    it("accepts names in scope, including the configured project number", async () => {
      const { capsule, urls } = scopeCapsule({ projectNumber: "123456" });
      await capsule.service.status({ id: "s" });
      await capsule.service.status({ id: "projects/p/locations/l/services/s" });
      await capsule.service.status({ id: "projects/123456/locations/l/services/s" });
      expect(urls).toHaveLength(3);
    });
  });
});
