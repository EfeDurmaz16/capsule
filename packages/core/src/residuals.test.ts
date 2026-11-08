import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  Capsule,
  JobLeases,
  MemoryReceiptStore,
  PolicyViolationError,
  UnsupportedCapabilityError,
  cleanupGrantProblem,
  consentApprovals,
  liveSet,
  withJobLease,
  type CapsuleAdapter,
  type CapsuleApprovalGrant,
  type CleanupApprovalRequest,
  type LabeledResource,
  type Sandbox
} from "./index.js";

const scratch = mkdtempSync(join(tmpdir(), "capsule-residuals-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const capabilities = {
  sandbox: { create: "native", exec: "native", fileRead: "native", fileWrite: "native", fileList: "native", destroy: "native" }
} as const;

// A provider that keeps labelled sandboxes in memory, the way Docker keeps labelled containers.
function labellingAdapter(options: { keepAfterDestroy?: boolean; withResiduals?: boolean } = {}) {
  const resources = new Map<string, LabeledResource>();
  const calls: string[] = [];
  let next = 0;
  const sandbox = (id: string): Sandbox => ({
    handle: { id, provider: "fake", createdAt: "2026-11-08T00:00:00.000Z" },
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] }),
    writeFile: async () => undefined,
    readFile: async () => new Uint8Array(),
    listFiles: async () => [],
    destroy: async () => {
      calls.push(`destroy:${id}`);
      if (!options.keepAfterDestroy) resources.delete(id);
    }
  });
  const adapter: CapsuleAdapter = {
    name: "fake",
    provider: "fake",
    capabilities,
    sandbox: {
      create: async (spec) => {
        const id = `sb-${(next += 1)}`;
        calls.push(`create:${id}`);
        const labels = spec.labels ?? {};
        if (labels.capsule_operation) {
          resources.set(id, {
            provider: "fake",
            kind: "sandbox",
            id,
            operation: labels.capsule_operation,
            ...(labels.capsule_job ? { job: labels.capsule_job } : {})
          });
        }
        return sandbox(id);
      },
      attach: async (spec) => {
        calls.push(`attach:${spec.id}`);
        return sandbox(spec.id);
      }
    },
    ...(options.withResiduals === false ? {} : { residuals: { list: async () => [...resources.values()] } })
  };
  return { adapter, resources, calls };
}

function freshGrant(request: CleanupApprovalRequest, overrides: Partial<CapsuleApprovalGrant> = {}): CapsuleApprovalGrant {
  return {
    approved: true,
    id: "gc-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    capabilities: [request.capabilityPath],
    resources: [request.resource],
    ...overrides
  };
}

describe("owner labels", () => {
  test("a Capsule with an owner labels every create with a new operation and its job", async () => {
    const { adapter, resources } = labellingAdapter();
    const capsule = new Capsule({ adapter, owner: { job: "job_a" } });
    await capsule.sandbox.create({ labels: { team: "x", capsule_job: "spoofed" } });
    await capsule.sandbox.create({});
    const [first, second] = [...resources.values()];
    expect(first).toMatchObject({ job: "job_a", operation: expect.stringMatching(/^op_[0-9a-f]{32}$/) });
    expect(second?.operation).not.toBe(first?.operation);
  });

  test("without an owner nothing is added, and an invalid job id is refused up front", async () => {
    const { adapter, resources } = labellingAdapter();
    await new Capsule({ adapter }).sandbox.create({});
    expect(resources.size).toBe(0);
    expect(() => new Capsule({ adapter, owner: { job: "has space" } })).toThrow(TypeError);
  });
});

describe("JobLeases", () => {
  test("live while the holder runs, exited when its process is gone, ended after end(), unknown otherwise", async () => {
    const dir = join(scratch, "leases");
    let running = true;
    const leases = new JobLeases(dir, "host-a", () => running);
    const lease = await leases.open({ adapter: "fake" });
    expect(await leases.liveness({ operation: "op", job: lease.job })).toBe("live");
    running = false;
    expect(await leases.liveness({ operation: "op", job: lease.job })).toBe("exited");
    await lease.end();
    expect(await leases.liveness({ operation: "op", job: lease.job })).toBe("ended");
    expect(await leases.liveness({ operation: "op" })).toBe("unknown");
    expect(await leases.liveness({ operation: "op", job: "job_elsewhere" })).toBe("unknown");
    expect(await new JobLeases(dir, "host-b", () => false).liveness({ operation: "op", job: lease.job })).toBe("unknown");
    await (await leases.open({ job: "job_done" })).end({ released: true });
    expect(await leases.read("job_done")).toBeUndefined();
  });

  test("a lease file that does not name its job is ignored", async () => {
    const dir = join(scratch, "forged");
    const leases = new JobLeases(dir, "host-a", () => false);
    await (await leases.open({ job: "job_x" })).end();
    writeFileSync(join(dir, "job_x.json"), JSON.stringify({ job: "job_y", host: "host-a", pid: 1, startedAt: "x", endedAt: "x" }));
    expect(await leases.liveness({ operation: "op", job: "job_x" })).toBe("unknown");
  });
});

describe("cleanupGrantProblem", () => {
  const request: CleanupApprovalRequest = { capabilityPath: "sandbox.destroy", resource: { type: "sandbox", id: "sb-1", provider: "fake" } };
  test.each([
    [{ approved: false }, "not approved"],
    [{ expiresAt: undefined }, "no expiresAt"],
    [{ expiresAt: "2000-01-01T00:00:00.000Z" }, "expired"],
    [{ capabilities: undefined }, "not scoped to capabilities"],
    [{ capabilities: ["sandbox.create", "sandbox.destroy"] }, "also authorizes a create"],
    [{ capabilities: ["sandbox.exec"] }, "not valid for sandbox.destroy"],
    [{ resources: undefined }, "not scoped to resources"],
    [{ resources: [{ type: "sandbox", provider: "fake" }] }, "not valid for sb-1"],
    [{ resources: [{ type: "sandbox", id: "sb-1", provider: "other" }] }, "not valid for sb-1"]
  ])("refuses %j", (overrides, problem) => {
    expect(cleanupGrantProblem(freshGrant(request, overrides as Partial<CapsuleApprovalGrant>), request)).toContain(problem);
  });

  test("accepts a fresh grant scoped to the cleanup and the resource", () => {
    expect(cleanupGrantProblem(freshGrant(request), request)).toBeUndefined();
  });
});

describe("Capsule.gc", () => {
  test("scan splits residuals from kept resources and changes nothing", async () => {
    const { adapter, calls } = labellingAdapter();
    await new Capsule({ adapter, owner: { job: "job_dead" } }).sandbox.create({});
    await new Capsule({ adapter, owner: { job: "job_live" } }).sandbox.create({});
    const scan = await new Capsule({ adapter }).gc.scan({ liveness: liveSet({ jobs: ["job_live"] }) });
    expect(scan.residuals.map((entry) => entry.resource.job)).toEqual(["job_dead"]);
    expect(scan.kept.map((entry) => entry.resource.job)).toEqual(["job_live"]);
    expect(calls).toEqual(["create:sb-1", "create:sb-2"]);
  });

  test("scan fails closed on an adapter that cannot list", async () => {
    const { adapter } = labellingAdapter({ withResiduals: false });
    await expect(new Capsule({ adapter }).gc.scan({ liveness: liveSet({}) })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  test("remove needs a fresh scoped grant per resource, writes a receipt per removal, and observes it gone", async () => {
    const { adapter, calls, resources } = labellingAdapter();
    await new Capsule({ adapter, owner: { job: "job_dead" } }).sandbox.create({});
    await new Capsule({ adapter, owner: { job: "job_dead" } }).sandbox.create({});
    const store = new MemoryReceiptStore();
    const requests: CleanupApprovalRequest[] = [];
    const report = await new Capsule({ adapter, receipts: true, receiptStore: store, receiptPersistence: "required" }).gc.remove({
      liveness: liveSet({}),
      reason: "crash",
      approve: (request) => {
        requests.push(request);
        // The create grant of the first sandbox, offered again: never enough to remove it.
        return request.resource.id === "sb-1"
          ? { approved: true, id: "create", capabilities: ["sandbox.create"], resources: [request.resource] }
          : freshGrant(request);
      }
    });
    expect(requests.map((request) => [request.capabilityPath, request.resource.id, request.context?.scope?.job])).toEqual([
      ["sandbox.destroy", "sb-1", "job_dead"],
      ["sandbox.destroy", "sb-2", "job_dead"]
    ]);
    expect(report.results.map((result) => [result.resource.id, result.outcome])).toEqual([
      ["sb-1", "denied"],
      ["sb-2", "removed"]
    ]);
    expect(calls).toEqual(["create:sb-1", "create:sb-2", "attach:sb-2", "destroy:sb-2"]);
    expect([...resources.keys()]).toEqual(["sb-1"]);
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0]).toMatchObject({
      type: "sandbox.destroy",
      resource: { id: "sb-2", status: "deleted" },
      metadata: { gc: "ended", capsuleJob: "job_dead", reason: "crash" }
    });
    expect(report.results[1]?.receipts).toEqual([store.receipts[0]?.id]);
  });

  test("a removal the second scan still sees is unconfirmed, not removed", async () => {
    const { adapter } = labellingAdapter({ keepAfterDestroy: true });
    await new Capsule({ adapter, owner: { job: "job_dead" } }).sandbox.create({});
    const report = await new Capsule({ adapter, receipts: true }).gc.remove({ liveness: liveSet({}), approve: (request) => freshGrant(request) });
    expect(report.results.map((result) => result.outcome)).toEqual(["unconfirmed"]);
  });

  test("no approval, live owners and other kinds are never removed", async () => {
    const { adapter, calls, resources } = labellingAdapter();
    await new Capsule({ adapter, owner: { job: "job_dead" } }).sandbox.create({});
    await new Capsule({ adapter, owner: { job: "job_live" } }).sandbox.create({});
    resources.set("run-1", { provider: "fake", kind: "job-container", id: "run-1", operation: "op_x", job: "job_dead" });
    const report = await new Capsule({ adapter, receipts: true }).gc.remove({ liveness: liveSet({ jobs: ["job_live"] }), approve: () => undefined });
    expect(report.results.map((result) => [result.resource.id, result.outcome])).toEqual([
      ["sb-1", "denied"],
      ["run-1", "skipped"]
    ]);
    expect(report.kept.map((entry) => entry.resource.id)).toEqual(["sb-2"]);
    expect(calls.filter((call) => call.startsWith("destroy"))).toEqual([]);
  });

  test("remove refuses to run without receipts", async () => {
    const { adapter } = labellingAdapter();
    await expect(new Capsule({ adapter }).gc.remove({ liveness: liveSet({}), approve: (request) => freshGrant(request) })).rejects.toBeInstanceOf(
      PolicyViolationError
    );
  });
});

describe("consentApprovals and withJobLease", () => {
  test("each confirmed resource gets one fresh grant that passes the cleanup check; others get none", async () => {
    const approve = consentApprovals(["sb-1"], { approver: "tester" });
    const request: CleanupApprovalRequest = { capabilityPath: "sandbox.destroy", resource: { type: "sandbox", id: "sb-1", provider: "fake" } };
    const grant = await approve(request);
    expect(grant && cleanupGrantProblem(grant, request)).toBeUndefined();
    expect(await approve(request)).toBeUndefined();
    expect(await approve({ ...request, resource: { ...request.resource, id: "sb-2" } })).toBeUndefined();
  });

  test("the lease is released when work returns and left for gc when it throws; no lease without residual support", async () => {
    const leases = new JobLeases(join(scratch, "with"), "host-a", () => false);
    const { adapter } = labellingAdapter();
    const job = await withJobLease(adapter, async (owner) => owner!.job, leases);
    expect(await leases.read(job)).toBeUndefined();
    let failed = "";
    await expect(
      withJobLease(
        adapter,
        async (owner) => {
          failed = owner!.job;
          throw new Error("crash");
        },
        leases
      )
    ).rejects.toThrow("crash");
    expect(await leases.liveness({ operation: "op", job: failed })).toBe("ended");
    expect(await withJobLease(labellingAdapter({ withResiduals: false }).adapter, async (owner) => owner, leases)).toBeUndefined();
  });

  test("forgetFinished keeps the lease of a job with anything left", async () => {
    const leases = new JobLeases(join(scratch, "forget"), "host-a", () => false);
    await (await leases.open({ job: "job_done" })).end();
    await (await leases.open({ job: "job_left" })).end();
    const resource = (id: string, job: string) => ({ provider: "fake", kind: "sandbox", id, operation: "op", job });
    await leases.forgetFinished({
      provider: "fake",
      adapter: "fake",
      results: [
        { resource: resource("a", "job_done"), verdict: "ended", outcome: "removed", receipts: [] },
        { resource: resource("b", "job_left"), verdict: "ended", outcome: "denied", receipts: [] }
      ],
      kept: []
    });
    expect(await leases.read("job_done")).toBeUndefined();
    expect(await leases.read("job_left")).toBeDefined();
  });
});
