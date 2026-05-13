import { UnsupportedCapabilityError } from "./errors.js";
import { Capsule } from "./capsule.js";
import { supportLevel, type CapabilityPath } from "./capabilities.js";
import type { CapsuleAdapter } from "./adapters.js";

type PublicCapability = {
  path: CapabilityPath;
  isImplemented(adapter: CapsuleAdapter): boolean;
  exercise(capsule: Capsule): Promise<unknown>;
};

const publicCapabilities: PublicCapability[] = [
  {
    path: "sandbox.create",
    isImplemented: (adapter) => typeof adapter.sandbox?.create === "function",
    exercise: (capsule) => capsule.sandbox.create({ image: "capsule-contract-test" })
  },
  {
    path: "job.run",
    isImplemented: (adapter) => typeof adapter.job?.run === "function",
    exercise: (capsule) => capsule.job.run({ image: "capsule-contract-test" })
  },
  {
    path: "job.status",
    isImplemented: (adapter) => typeof adapter.job?.status === "function",
    exercise: (capsule) => capsule.job.status({ id: "capsule-contract-test" })
  },
  {
    path: "job.cancel",
    isImplemented: (adapter) => typeof adapter.job?.cancel === "function",
    exercise: (capsule) => capsule.job.cancel({ id: "capsule-contract-test" })
  },
  {
    path: "service.deploy",
    isImplemented: (adapter) => typeof adapter.service?.deploy === "function",
    exercise: (capsule) => capsule.service.deploy({ name: "capsule-contract-test", image: "capsule-contract-test" })
  },
  {
    path: "service.status",
    isImplemented: (adapter) => typeof adapter.service?.status === "function",
    exercise: (capsule) => capsule.service.status({ id: "capsule-contract-test" })
  },
  {
    path: "service.update",
    isImplemented: (adapter) => typeof adapter.service?.update === "function",
    exercise: (capsule) => capsule.service.update({ id: "capsule-contract-test", image: "capsule-contract-test" })
  },
  {
    path: "service.delete",
    isImplemented: (adapter) => typeof adapter.service?.delete === "function",
    exercise: (capsule) => capsule.service.delete({ id: "capsule-contract-test" })
  },
  {
    path: "edge.deploy",
    isImplemented: (adapter) => typeof adapter.edge?.deploy === "function",
    exercise: (capsule) => capsule.edge.deploy({ name: "capsule-contract-test", source: { path: "/tmp/capsule-contract-test.js" } })
  },
  {
    path: "edge.status",
    isImplemented: (adapter) => typeof adapter.edge?.status === "function",
    exercise: (capsule) => capsule.edge.status({ id: "capsule-contract-test" })
  },
  {
    path: "edge.version",
    isImplemented: (adapter) => typeof adapter.edge?.version === "function",
    exercise: (capsule) => capsule.edge.version({ name: "capsule-contract-test", source: { path: "/tmp/capsule-contract-test.js" } })
  },
  {
    path: "edge.release",
    isImplemented: (adapter) => typeof adapter.edge?.release === "function",
    exercise: (capsule) => capsule.edge.release({ versionId: "capsule-contract-test" })
  },
  {
    path: "edge.rollback",
    isImplemented: (adapter) => typeof adapter.edge?.rollback === "function",
    exercise: (capsule) => capsule.edge.rollback({ deploymentId: "capsule-contract-test" })
  },
  {
    path: "database.branchCreate",
    isImplemented: (adapter) => typeof adapter.database?.branch.create === "function",
    exercise: (capsule) => capsule.database.branch.create({ project: "capsule-contract-test", name: "capsule-contract-test" })
  },
  {
    path: "database.branchDelete",
    isImplemented: (adapter) => typeof adapter.database?.branch.delete === "function",
    exercise: (capsule) => capsule.database.branch.delete({ project: "capsule-contract-test", branchId: "capsule-contract-test" })
  },
  {
    path: "database.branchReset",
    isImplemented: (adapter) => typeof adapter.database?.branch.reset === "function",
    exercise: (capsule) =>
      capsule.database.branch.reset({
        project: "capsule-contract-test",
        branchId: "capsule-contract-test",
        sourceBranchId: "capsule-contract-source"
      })
  },
  {
    path: "database.migrate",
    isImplemented: (adapter) => typeof adapter.database?.migrate === "function",
    exercise: (capsule) => capsule.database.migrate({ project: "capsule-contract-test", branchId: "capsule-contract-test", dryRun: true })
  },
  {
    path: "preview.create",
    isImplemented: (adapter) => typeof adapter.preview?.create === "function",
    exercise: (capsule) => capsule.preview.create({ name: "capsule-contract-test" })
  },
  {
    path: "machine.create",
    isImplemented: (adapter) => typeof adapter.machine?.create === "function",
    exercise: (capsule) => capsule.machine.create({ name: "capsule-contract-test", image: "capsule-contract-test", size: "capsule-contract-test" })
  }
];

export function assertAdapterContract(adapter: CapsuleAdapter): void {
  if (!adapter.name) {
    throw new Error("Adapter must declare a name");
  }
  if (!adapter.provider) {
    throw new Error("Adapter must declare a provider");
  }
  if (!adapter.capabilities) {
    throw new Error("Adapter must declare capabilities");
  }
  for (const capability of publicCapabilities) {
    const level = supportLevel(adapter.capabilities, capability.path);
    const implemented = capability.isImplemented(adapter);
    if (level !== "unsupported" && !implemented) {
      throw new Error(`Adapter ${adapter.name} declares ${capability.path} as ${level} but does not implement the public contract.`);
    }
    if (level === "unsupported" && implemented) {
      throw new Error(`Adapter ${adapter.name} implements ${capability.path} but declares it unsupported.`);
    }
  }
}

export async function assertUnsupportedCapabilityGuards(adapter: CapsuleAdapter): Promise<void> {
  assertAdapterContract(adapter);
  const capsule = new Capsule({ adapter });

  for (const capability of publicCapabilities) {
    if (supportLevel(adapter.capabilities, capability.path) !== "unsupported") {
      continue;
    }
    try {
      await capability.exercise(capsule);
    } catch (error) {
      if (error instanceof UnsupportedCapabilityError && error.capabilityPath === capability.path) {
        continue;
      }
      throw error;
    }
    throw new Error(`Adapter ${adapter.name} did not reject unsupported capability ${capability.path}.`);
  }
}

export async function runAdapterContract(adapter: CapsuleAdapter): Promise<void> {
  assertAdapterContract(adapter);
  await assertUnsupportedCapabilityGuards(adapter);
}
