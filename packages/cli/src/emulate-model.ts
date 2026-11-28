import assert from "node:assert/strict";
import { Capsule, MemoryReceiptStore, verifyReceipt, type CapabilityMap } from "@capsule-sdk/core";
import {
  createMockAdapter,
  mockCloudRun,
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
} from "@capsule-sdk/mock";
import { isEmulationProvider, modelScenarioOperations, type EmulationProvider } from "./emulate-catalog.js";

function model(provider: EmulationProvider, capabilities: CapabilityMap) {
  return () => createMockAdapter({ provider, name: `mock-${provider}`, capabilities });
}

// These four providers have real adapters but no preset in @capsule-sdk/mock.
// Declare only the subset the local fixture exercises.
const machineModel: CapabilityMap = {
  machine: { create: "emulated", status: "emulated", destroy: "emulated", start: "unsupported", stop: "unsupported", exec: "unsupported" }
};
const models = {
  "azure-container-apps": model("azure-container-apps", {
    job: {
      run: "emulated",
      status: "unsupported",
      cancel: "unsupported",
      logs: "unsupported",
      artifacts: "unsupported",
      timeout: "unsupported",
      env: "unsupported"
    }
  }),
  "cloud-run": mockCloudRun,
  cloudflare: mockCloudflare,
  daytona: mockDaytona,
  docker: model("docker", {
    sandbox: { create: "emulated", fileWrite: "emulated", fileRead: "emulated", exec: "emulated", destroy: "emulated", fileList: "unsupported" }
  }),
  e2b: mockE2B,
  ec2: mockEC2,
  ecs: mockECS,
  fly: model("fly", machineModel),
  gce: model("gce", machineModel),
  kubernetes: mockKubernetes,
  lambda: mockLambda,
  modal: mockModal,
  neon: mockNeon,
  vercel: mockVercel
} satisfies Record<EmulationProvider, () => ReturnType<typeof createMockAdapter>>;

const fixtureName = "emulate-example";
const filePath = "/workspace/marker.txt";
const marker = "capsule-model-fixture";

async function exercise(capsule: Capsule, provider: EmulationProvider) {
  switch (modelScenarioOperations[provider][0]) {
    case "sandbox.create": {
      const box = await capsule.sandbox.create({ name: fixtureName, image: "model" });
      try {
        await box.writeFile(filePath, marker);
        assert.equal(new TextDecoder().decode(await box.readFile(filePath)), marker);
        const executed = await box.exec({ command: ["echo", marker] });
        assert.equal(executed.exitCode, 0);
        assert.equal(executed.stdout, `mock:${provider}: echo ${marker}\n`);
      } finally {
        await box.destroy();
      }
      return {
        result: { resourceId: box.handle.id, status: "deleted" },
        cleanup: "model-destroyed",
        assertions: ["File contents matched after a write/read round trip.", "Model exec returned its expected output and exit code."]
      };
    }
    case "machine.create": {
      const created = await capsule.machine.create({ name: fixtureName });
      try {
        const observed = await capsule.machine.status({ id: created.id });
        assert.equal(observed.id, created.id);
        assert.equal(observed.status, "running");
      } finally {
        const deleted = await capsule.machine.destroy({ id: created.id });
        assert.equal(deleted.id, created.id);
        assert.equal(deleted.status, "deleted");
      }
      return {
        result: { resourceId: created.id, status: "deleted" },
        cleanup: "model-destroyed",
        assertions: ["Model status and destroy returned the created machine ID.", "Model state responses were running and deleted."]
      };
    }
    case "job.run": {
      const job = await capsule.job.run({ name: fixtureName, image: "model", command: ["echo", marker] });
      assert.equal(job.status, "succeeded");
      assert.equal(job.result?.exitCode, 0);
      assert.equal(job.result.stdout, `mock:${provider}: job ${fixtureName} completed\n`);
      return {
        result: { resourceId: job.id, status: job.status },
        cleanup: "no-retained-model-state",
        assertions: ["Model job completed with the expected output and exit code."]
      };
    }
    case "edge.deploy": {
      const deployment = await capsule.edge.deploy({ name: fixtureName, runtime: "workers" });
      assert.equal(deployment.status, "ready");
      assert.equal(deployment.url, `https://${fixtureName}.${provider}.edge.mock.capsule.dev`);
      return {
        result: { resourceId: deployment.id, status: deployment.status },
        cleanup: "no-retained-model-state",
        assertions: ["Model deployment reported ready and returned its fixture URL."]
      };
    }
    case "database.branchCreate": {
      const project = "model-project";
      const branch = await capsule.database.branch.create({ project, name: fixtureName });
      try {
        assert.equal(branch.status, "ready");
        assert.equal(branch.project, project);
      } finally {
        const removed = await capsule.database.branch.delete({ project, branchId: branch.id });
        assert.equal(removed.id, branch.id);
        assert.equal(removed.status, "deleted");
      }
      return {
        result: { resourceId: branch.id, status: "deleted" },
        cleanup: "model-destroyed",
        assertions: ["Model branch was ready in the requested project.", "Deletion returned the created branch ID and deleted status."]
      };
    }
  }
}

/** Exercise public Capsule methods against isolated in-memory state and return deterministic evidence. */
export async function runModelScenario(provider: string) {
  if (!isEmulationProvider(provider)) throw new Error(`Unknown emulation provider: ${provider}`);
  const adapter = models[provider]();
  const store = new MemoryReceiptStore();
  const capsule = new Capsule({ adapter, receipts: true, receiptStore: store, receiptPersistence: "required" });
  const outcome = await exercise(capsule, provider);
  const operations = store.receipts.map((receipt) => receipt.capabilityPath);
  assert.deepEqual(operations, modelScenarioOperations[provider]);
  for (const receipt of store.receipts) {
    assert.equal(receipt.provider, provider);
    assert.equal(receipt.adapter, adapter.name);
    assert.ok(verifyReceipt(receipt).valid, `Invalid model receipt for ${receipt.capabilityPath}`);
  }
  return {
    provider,
    evidence: "model" as const,
    operations,
    result: outcome.result,
    cleanup: outcome.cleanup,
    assertions: [...outcome.assertions, "Verified Capsule receipts matched the modeled provider and operation sequence."]
  };
}
