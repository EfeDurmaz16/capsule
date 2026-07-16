import { describe, expect, test } from "vitest";
import { AdapterExecutionError, Capsule, ProviderRetryableError, UnsupportedCapabilityError, runAdapterContract, verifyReceipt } from "@capsule/core";
import {
  createMockAdapter,
  mockCloudRun,
  mockCloudRunCapabilities,
  mockCloudflare,
  mockDaytona,
  mockE2B,
  mockEC2,
  mockECS,
  mockKubernetes,
  mockLambda,
  mockModal,
  mockNeon,
  mockVercel
} from "./index.js";

const allMocks = [mockCloudRun, mockCloudflare, mockDaytona, mockE2B, mockEC2, mockECS, mockKubernetes, mockLambda, mockModal, mockNeon, mockVercel];

describe("mock adapters", () => {
  test("mockE2B capabilities", () => {
    const capsule = new Capsule({ adapter: mockE2B() });
    expect(capsule.supportLevel("sandbox.exec")).toBe("native");
    expect(capsule.supportLevel("job.run")).toBe("emulated");
    expect(capsule.supports("service.deploy")).toBe(false);
  });

  test("mockCloudRun supports service.deploy", () => {
    expect(new Capsule({ adapter: mockCloudRun() }).supportLevel("service.deploy")).toBe("native");
  });

  test("mockVercel supports edge.deploy", () => {
    expect(new Capsule({ adapter: mockVercel() }).supportLevel("edge.deploy")).toBe("native");
  });

  test("mockCloudflare supports edge.deploy", () => {
    expect(new Capsule({ adapter: mockCloudflare() }).supportLevel("edge.deploy")).toBe("native");
  });

  test("mockNeon supports database.branchCreate", () => {
    expect(new Capsule({ adapter: mockNeon() }).supportLevel("database.branchCreate")).toBe("native");
  });

  test("mockEC2 supports machine.create", () => {
    expect(new Capsule({ adapter: mockEC2() }).supportLevel("machine.create")).toBe("native");
  });

  test("mockKubernetes can create experimental machine receipts", async () => {
    const capsule = new Capsule({ adapter: mockKubernetes(), receipts: true });
    const machine = await capsule.machine.create({ name: "runner" });
    expect(machine.receipt?.supportLevel).toBe("experimental");
  });

  test("mock receipts expose mock metadata", async () => {
    const capsule = new Capsule({ adapter: mockCloudRun(), receipts: true });
    const service = await capsule.service.deploy({ name: "api", image: "ghcr.io/acme/api:latest" });

    expect(service.receipt?.metadata).toMatchObject({
      mock: true,
      mockProvider: "cloud-run",
      mockAdapter: "mock-cloud-run"
    });
  });
});

describe("mock adapter contract", () => {
  // Running the shared conformance suite proves every declared capability level matches what the
  // mock actually implements, that unsupported capabilities fail closed, and that approval-gated
  // capabilities deny before execution.
  for (const make of allMocks) {
    test(`${make().name} satisfies the shared adapter contract`, async () => {
      await runAdapterContract(make());
    });
  }

  test("simulated mock provider failures flow through the shared failure-scenario harness", async () => {
    const failing = createMockAdapter({
      name: "mock-cloud-run",
      provider: "cloud-run",
      capabilities: mockCloudRunCapabilities,
      failWith: { category: "retryable", retryable: true, status: 503 }
    });

    await runAdapterContract(failing, {
      failureScenarios: [
        {
          name: "mock provider failure surfaces a typed retryable provider error",
          exercise: (capsule) => capsule.job.run({ image: "node:22" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderRetryableError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "retryable", retryable: true, status: 503 } });
          }
        }
      ]
    });
  });
});

describe("mock happy paths produce verifiable receipts", () => {
  test("sandbox create + exec", async () => {
    const capsule = new Capsule({ adapter: mockE2B(), receipts: true });
    const sandbox = await capsule.sandbox.create({ name: "build", image: "node:22" });
    const result = await sandbox.exec({ command: "echo hi" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mock:e2b");
    expect(result.receipt?.type).toBe("sandbox.exec");
    expect(verifyReceipt(result.receipt).valid).toBe(true);
  });

  test("sandbox file round-trip stays in-memory", async () => {
    const capsule = new Capsule({ adapter: mockE2B() });
    const sandbox = await capsule.sandbox.create({ name: "files" });
    await sandbox.writeFile("/work/app.txt", "hello");
    const data = await sandbox.readFile("/work/app.txt");
    const listing = await sandbox.listFiles("/work");

    expect(new TextDecoder().decode(data)).toBe("hello");
    expect(listing).toEqual([{ name: "app.txt", path: "/work/app.txt", type: "file", sizeBytes: 5 }]);
  });

  test("job run", async () => {
    const capsule = new Capsule({ adapter: mockCloudRun(), receipts: true });
    const job = await capsule.job.run({ name: "seed", image: "node:22", command: ["node", "seed.js"] });

    expect(job.status).toBe("succeeded");
    expect(job.result?.exitCode).toBe(0);
    expect(job.receipt?.type).toBe("job.run");
    expect(job.receipt?.supportLevel).toBe("native");
    expect(verifyReceipt(job.receipt).valid).toBe(true);
  });

  test("job logs", async () => {
    const capsule = new Capsule({ adapter: mockCloudRun(), receipts: true });
    const logs = await capsule.job.logs({ id: "job-1" });

    expect(logs.provider).toBe("cloud-run");
    expect(logs.logs.length).toBeGreaterThan(0);
    expect(verifyReceipt(logs.receipt).valid).toBe(true);
  });

  test("service deploy returns a fake url", async () => {
    const capsule = new Capsule({ adapter: mockCloudRun(), receipts: true });
    const service = await capsule.service.deploy({ name: "api", image: "ghcr.io/acme/api:latest" });

    expect(service.status).toBe("ready");
    expect(service.url).toBe("https://api.cloud-run.mock.capsule.dev");
    expect(verifyReceipt(service.receipt).valid).toBe(true);
  });

  test("edge deploy returns a fake url", async () => {
    const capsule = new Capsule({ adapter: mockVercel(), receipts: true });
    const edge = await capsule.edge.deploy({ name: "fn", source: { path: "/tmp/fn.js" } });

    expect(edge.status).toBe("ready");
    expect(edge.url).toBe("https://fn.vercel.edge.mock.capsule.dev");
    expect(verifyReceipt(edge.receipt).valid).toBe(true);
  });

  test("database branch create + delete", async () => {
    const capsule = new Capsule({ adapter: mockNeon(), receipts: true });
    const branch = await capsule.database.branch.create({ project: "proj", name: "pr-1" });

    expect(branch.status).toBe("ready");
    expect(branch.connectionString).toContain("postgresql://");
    expect(verifyReceipt(branch.receipt).valid).toBe(true);

    const deleted = await capsule.database.branch.delete({ project: "proj", branchId: branch.id });
    expect(deleted.status).toBe("deleted");
    expect(verifyReceipt(deleted.receipt).valid).toBe(true);
  });

  test("preview create returns fake urls for services and edges", async () => {
    const capsule = new Capsule({ adapter: mockKubernetes(), receipts: true });
    const preview = await capsule.preview.create({
      name: "pr-9",
      services: [{ name: "web", image: "node:22" }],
      edges: [{ name: "fn" }]
    });

    expect(preview.status).toBe("ready");
    expect(preview.urls).toContain("https://web.kubernetes.preview.mock.capsule.dev");
    expect(preview.urls).toContain("https://fn.kubernetes.preview.mock.capsule.dev");
    expect(preview.resources.map((resource) => resource.type)).toEqual(["service", "edge"]);
    expect(verifyReceipt(preview.receipt).valid).toBe(true);
  });

  test("machine lifecycle", async () => {
    const capsule = new Capsule({ adapter: mockEC2(), receipts: true });
    const created = await capsule.machine.create({ name: "runner", image: "ami-123", size: "t3.small" });

    expect(created.status).toBe("running");
    expect(created.receipt?.supportLevel).toBe("native");
    expect(verifyReceipt(created.receipt).valid).toBe(true);

    expect((await capsule.machine.status({ id: created.id })).status).toBe("running");
    expect((await capsule.machine.stop({ id: created.id })).status).toBe("stopped");
    expect((await capsule.machine.start({ id: created.id })).status).toBe("running");
    expect((await capsule.machine.destroy({ id: created.id })).status).toBe("deleted");
  });
});

describe("mock unsupported capabilities fail closed", () => {
  test("mockE2B rejects service.deploy", async () => {
    const capsule = new Capsule({ adapter: mockE2B() });
    await expect(capsule.service.deploy({ name: "api", image: "x" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  test("mockNeon rejects sandbox.create", async () => {
    const capsule = new Capsule({ adapter: mockNeon() });
    await expect(capsule.sandbox.create({ image: "x" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  test("mockVercel rejects machine.create", async () => {
    const capsule = new Capsule({ adapter: mockVercel() });
    await expect(capsule.machine.create({ name: "m" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  test("mockCloudRun rejects database.branchCreate", async () => {
    const capsule = new Capsule({ adapter: mockCloudRun() });
    await expect(capsule.database.branch.create({ project: "p", name: "b" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });
});
