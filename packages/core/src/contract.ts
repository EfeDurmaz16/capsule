import type { CapsuleAdapter } from "./adapters.js";
import { supportLevel, type CapabilityPath } from "./capabilities.js";
import { Capsule } from "./capsule.js";
import { UnsupportedCapabilityError } from "./errors.js";

export const executableCapabilityPaths = [
  "sandbox.create",
  "job.run",
  "service.deploy",
  "edge.deploy",
  "database.branchCreate",
  "database.branchDelete",
  "preview.create",
  "machine.create"
] as const satisfies readonly CapabilityPath[];

export type ExecutableCapabilityPath = (typeof executableCapabilityPaths)[number];

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
  assertExecutableCapabilityImplementations(adapter);
}

export function unsupportedExecutableCapabilityPaths(adapter: CapsuleAdapter): ExecutableCapabilityPath[] {
  return executableCapabilityPaths.filter((path) => supportLevel(adapter.capabilities, path) === "unsupported");
}

export function assertExecutableCapabilityImplementations(adapter: CapsuleAdapter): void {
  for (const path of executableCapabilityPaths) {
    if (supportLevel(adapter.capabilities, path) !== "unsupported" && !hasExecutableCapabilityImplementation(adapter, path)) {
      throw new Error(`Adapter declares ${path} support but does not implement it`);
    }
  }
}

export async function assertUnsupportedCapabilityRejects(adapter: CapsuleAdapter, path: ExecutableCapabilityPath): Promise<void> {
  if (supportLevel(adapter.capabilities, path) !== "unsupported") {
    throw new Error(`Capability is not declared unsupported: ${path}`);
  }

  try {
    await invokeExecutableCapability(new Capsule({ adapter }), path);
  } catch (error) {
    if (error instanceof UnsupportedCapabilityError && error.capabilityPath === path) {
      return;
    }
    throw new Error(`Expected ${path} to reject with UnsupportedCapabilityError`, { cause: error });
  }

  throw new Error(`Expected unsupported capability to reject: ${path}`);
}

export async function assertUnsupportedCapabilitiesReject(adapter: CapsuleAdapter, paths = unsupportedExecutableCapabilityPaths(adapter)): Promise<void> {
  for (const path of paths) {
    await assertUnsupportedCapabilityRejects(adapter, path);
  }
}

async function invokeExecutableCapability(capsule: Capsule, path: ExecutableCapabilityPath): Promise<unknown> {
  switch (path) {
    case "sandbox.create":
      return await capsule.sandbox.create({ image: "node:22", name: "unsupported-contract" });
    case "job.run":
      return await capsule.job.run({ image: "node:22", name: "unsupported-contract" });
    case "service.deploy":
      return await capsule.service.deploy({ name: "unsupported-contract", image: "node:22" });
    case "edge.deploy":
      return await capsule.edge.deploy({ name: "unsupported-contract", source: { path: "/tmp/unsupported-contract.js" } });
    case "database.branchCreate":
      return await capsule.database.branch.create({ project: "unsupported-contract", name: "unsupported-contract" });
    case "database.branchDelete":
      return await capsule.database.branch.delete({ project: "unsupported-contract", branchId: "br_unsupported_contract" });
    case "preview.create":
      return await capsule.preview.create({ name: "unsupported-contract" });
    case "machine.create":
      return await capsule.machine.create({ name: "unsupported-contract", image: "ami-unsupported" });
  }
}

function hasExecutableCapabilityImplementation(adapter: CapsuleAdapter, path: ExecutableCapabilityPath): boolean {
  switch (path) {
    case "sandbox.create":
      return Boolean(adapter.sandbox?.create);
    case "job.run":
      return Boolean(adapter.job?.run);
    case "service.deploy":
      return Boolean(adapter.service?.deploy);
    case "edge.deploy":
      return Boolean(adapter.edge?.deploy);
    case "database.branchCreate":
      return Boolean(adapter.database?.branch.create);
    case "database.branchDelete":
      return Boolean(adapter.database?.branch.delete);
    case "preview.create":
      return Boolean(adapter.preview?.create);
    case "machine.create":
      return Boolean(adapter.machine?.create);
  }
}
