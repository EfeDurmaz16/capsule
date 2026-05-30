import { PolicyViolationError, UnsupportedCapabilityError } from "./errors.js";
import { Capsule, type CapsuleOptions } from "./capsule.js";
import { supportLevel, type CapabilityPath } from "./capabilities.js";
import type { CapsuleAdapter } from "./adapters.js";
import type { CapsuleDomain } from "./types.js";

type PublicCapability = {
  path: CapabilityPath;
  requiresApproval?: boolean;
  isImplemented(adapter: CapsuleAdapter): boolean;
  exercise(capsule: Capsule): Promise<unknown>;
};

export interface CapsuleAdapterFailureScenario {
  name: string;
  exercise(capsule: Capsule): Promise<unknown>;
  expectError(error: unknown): void;
  capsuleOptions?: Omit<CapsuleOptions, "adapter">;
}

export interface CapsuleAdapterContractOptions {
  domains?: CapsuleDomain[];
  capabilities?: CapabilityPath[];
  failureScenarios?: CapsuleAdapterFailureScenario[];
}

const publicCapabilities: PublicCapability[] = [
  {
    path: "sandbox.create",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.sandbox?.create === "function",
    exercise: (capsule) => capsule.sandbox.create({ image: "capsule-contract-test" })
  },
  {
    path: "job.run",
    requiresApproval: true,
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
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.job?.cancel === "function",
    exercise: (capsule) => capsule.job.cancel({ id: "capsule-contract-test" })
  },
  {
    path: "job.logs",
    isImplemented: (adapter) => typeof adapter.job?.logs === "function",
    exercise: (capsule) => capsule.job.logs({ id: "capsule-contract-test" })
  },
  {
    path: "service.deploy",
    requiresApproval: true,
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
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.service?.update === "function",
    exercise: (capsule) => capsule.service.update({ id: "capsule-contract-test", image: "capsule-contract-test" })
  },
  {
    path: "service.rollback",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.service?.rollback === "function",
    exercise: (capsule) => capsule.service.rollback({ id: "capsule-contract-test", revision: "capsule-contract-revision" })
  },
  {
    path: "service.delete",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.service?.delete === "function",
    exercise: (capsule) => capsule.service.delete({ id: "capsule-contract-test" })
  },
  {
    path: "service.logs",
    isImplemented: (adapter) => typeof adapter.service?.logs === "function",
    exercise: (capsule) => capsule.service.logs({ id: "capsule-contract-test" })
  },
  {
    path: "edge.deploy",
    requiresApproval: true,
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
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.edge?.version === "function",
    exercise: (capsule) => capsule.edge.version({ name: "capsule-contract-test", source: { path: "/tmp/capsule-contract-test.js" } })
  },
  {
    path: "edge.release",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.edge?.release === "function",
    exercise: (capsule) => capsule.edge.release({ versionId: "capsule-contract-test" })
  },
  {
    path: "edge.rollback",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.edge?.rollback === "function",
    exercise: (capsule) => capsule.edge.rollback({ deploymentId: "capsule-contract-test" })
  },
  {
    path: "edge.logs",
    isImplemented: (adapter) => typeof adapter.edge?.logs === "function",
    exercise: (capsule) => capsule.edge.logs({ id: "capsule-contract-test" })
  },
  {
    path: "database.branchCreate",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.database?.branch.create === "function",
    exercise: (capsule) => capsule.database.branch.create({ project: "capsule-contract-test", name: "capsule-contract-test" })
  },
  {
    path: "database.branchDelete",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.database?.branch.delete === "function",
    exercise: (capsule) => capsule.database.branch.delete({ project: "capsule-contract-test", branchId: "capsule-contract-test" })
  },
  {
    path: "database.branchReset",
    requiresApproval: true,
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
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.database?.migrate === "function",
    exercise: (capsule) => capsule.database.migrate({ project: "capsule-contract-test", branchId: "capsule-contract-test", dryRun: true })
  },
  {
    path: "preview.create",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.preview?.create === "function",
    exercise: (capsule) => capsule.preview.create({ name: "capsule-contract-test" })
  },
  {
    path: "preview.destroy",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.preview?.destroy === "function",
    exercise: (capsule) => capsule.preview.destroy({ id: "capsule-contract-test" })
  },
  {
    path: "preview.status",
    isImplemented: (adapter) => typeof adapter.preview?.status === "function",
    exercise: (capsule) => capsule.preview.status({ id: "capsule-contract-test" })
  },
  {
    path: "preview.logs",
    isImplemented: (adapter) => typeof adapter.preview?.logs === "function",
    exercise: (capsule) => capsule.preview.logs({ id: "capsule-contract-test" })
  },
  {
    path: "preview.urls",
    isImplemented: (adapter) => typeof adapter.preview?.urls === "function",
    exercise: (capsule) => capsule.preview.urls({ id: "capsule-contract-test" })
  },
  {
    path: "preview.cleanup",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.preview?.cleanup === "function",
    exercise: (capsule) => capsule.preview.cleanup({ id: "capsule-contract-test" })
  },
  {
    path: "machine.create",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.machine?.create === "function",
    exercise: (capsule) => capsule.machine.create({ name: "capsule-contract-test", image: "capsule-contract-test", size: "capsule-contract-test" })
  },
  {
    path: "machine.status",
    isImplemented: (adapter) => typeof adapter.machine?.status === "function",
    exercise: (capsule) => capsule.machine.status({ id: "capsule-contract-test" })
  },
  {
    path: "machine.start",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.machine?.start === "function",
    exercise: (capsule) => capsule.machine.start({ id: "capsule-contract-test" })
  },
  {
    path: "machine.stop",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.machine?.stop === "function",
    exercise: (capsule) => capsule.machine.stop({ id: "capsule-contract-test" })
  },
  {
    path: "machine.destroy",
    requiresApproval: true,
    isImplemented: (adapter) => typeof adapter.machine?.destroy === "function",
    exercise: (capsule) => capsule.machine.destroy({ id: "capsule-contract-test" })
  }
];

function selectedPublicCapabilities(options: CapsuleAdapterContractOptions = {}): PublicCapability[] {
  return publicCapabilities.filter((capability) => {
    const domain = capability.path.split(".")[0] as CapsuleDomain;
    return (!options.domains || options.domains.includes(domain)) && (!options.capabilities || options.capabilities.includes(capability.path));
  });
}

export function assertAdapterContract(adapter: CapsuleAdapter, options: CapsuleAdapterContractOptions = {}): void {
  if (!adapter.name) {
    throw new Error("Adapter must declare a name");
  }
  if (!adapter.provider) {
    throw new Error("Adapter must declare a provider");
  }
  if (!adapter.capabilities) {
    throw new Error("Adapter must declare capabilities");
  }
  for (const capability of selectedPublicCapabilities(options)) {
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

export async function assertUnsupportedCapabilityGuards(adapter: CapsuleAdapter, options: CapsuleAdapterContractOptions = {}): Promise<void> {
  assertAdapterContract(adapter, options);
  const capsule = new Capsule({ adapter });

  for (const capability of selectedPublicCapabilities(options)) {
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

export async function assertPolicyDenialGuards(adapter: CapsuleAdapter, options: CapsuleAdapterContractOptions = {}): Promise<void> {
  assertAdapterContract(adapter, options);
  const capsule = new Capsule({ adapter, policy: { approvals: { required: true, reason: "adapter contract policy denial check" } } });

  for (const capability of selectedPublicCapabilities(options)) {
    if (!capability.requiresApproval || supportLevel(adapter.capabilities, capability.path) === "unsupported") {
      continue;
    }
    try {
      await capability.exercise(capsule);
    } catch (error) {
      if (error instanceof PolicyViolationError) {
        continue;
      }
      throw error;
    }
    throw new Error(`Adapter ${adapter.name} did not fail closed for policy-denied capability ${capability.path}.`);
  }
}

export async function assertAdapterFailureScenarios(adapter: CapsuleAdapter, options: CapsuleAdapterContractOptions = {}): Promise<void> {
  assertAdapterContract(adapter, options);
  for (const scenario of options.failureScenarios ?? []) {
    const capsule = new Capsule({ receipts: true, ...scenario.capsuleOptions, adapter });
    try {
      await scenario.exercise(capsule);
    } catch (error) {
      scenario.expectError(error);
      continue;
    }
    throw new Error(`Adapter ${adapter.name} contract failure scenario "${scenario.name}" did not throw.`);
  }
}

export async function runAdapterContract(adapter: CapsuleAdapter, options: CapsuleAdapterContractOptions = {}): Promise<void> {
  assertAdapterContract(adapter, options);
  await assertUnsupportedCapabilityGuards(adapter, options);
  await assertPolicyDenialGuards(adapter, options);
  await assertAdapterFailureScenarios(adapter, options);
}

export async function runCapsuleAdapterContract(adapter: CapsuleAdapter, options: CapsuleAdapterContractOptions = {}): Promise<void> {
  await runAdapterContract(adapter, options);
}
