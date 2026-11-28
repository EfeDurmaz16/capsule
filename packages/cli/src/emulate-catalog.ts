import type { CapabilityPath } from "@capsule-sdk/core";

const sandboxLifecycle = ["sandbox.create", "sandbox.fileWrite", "sandbox.fileRead", "sandbox.exec", "sandbox.destroy"] as const;
const machineLifecycle = ["machine.create", "machine.status", "machine.destroy"] as const;
const runJob = ["job.run"] as const;
const deployEdge = ["edge.deploy"] as const;

export const modelScenarioOperations = {
  "azure-container-apps": runJob,
  "cloud-run": runJob,
  cloudflare: deployEdge,
  daytona: sandboxLifecycle,
  docker: sandboxLifecycle,
  e2b: sandboxLifecycle,
  ec2: machineLifecycle,
  ecs: runJob,
  fly: machineLifecycle,
  gce: machineLifecycle,
  kubernetes: runJob,
  lambda: runJob,
  modal: sandboxLifecycle,
  neon: ["database.branchCreate", "database.branchDelete"],
  vercel: deployEdge
} as const satisfies Record<string, readonly CapabilityPath[]>;

export type EmulationProvider = keyof typeof modelScenarioOperations;

export function isEmulationProvider(value: string): value is EmulationProvider {
  return Object.hasOwn(modelScenarioOperations, value);
}

export const emulationModes = {
  model: "Capsule operations exercised against an in-process model.",
  "provider-http": "The real Capsule adapter exercised against a local provider API emulator.",
  runtime: "A workload executed in a local runtime."
} as const;

export function emulationCatalog(provider?: EmulationProvider) {
  const providers = Object.keys(modelScenarioOperations).filter(isEmulationProvider);
  return {
    modes: emulationModes,
    providers: (provider === undefined ? providers : [provider]).map((name) => ({
      provider: name,
      operations: modelScenarioOperations[name],
      evidence: { model: "available", "provider-http": "unsupported", runtime: "unsupported" } as const
    }))
  };
}
