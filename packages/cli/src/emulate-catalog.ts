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

export const providerHttpScenarioOperations = {
  "azure-container-apps": ["service.status"],
  "cloud-run": ["service.status"],
  cloudflare: deployEdge,
  daytona: ["sandbox.create", "sandbox.exec", "sandbox.destroy"],
  docker: ["sandbox.create", "sandbox.destroy"],
  e2b: ["sandbox.create", "sandbox.destroy"],
  ec2: machineLifecycle,
  ecs: ["job.run", "job.status"],
  fly: machineLifecycle,
  gce: ["machine.status"],
  kubernetes: ["service.status"],
  lambda: runJob,
  modal: ["sandbox.create", "sandbox.destroy"],
  neon: modelScenarioOperations.neon,
  vercel: ["edge.deploy", "edge.status"]
} as const satisfies Record<EmulationProvider, readonly CapabilityPath[]>;

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
      providerHttpOperations: providerHttpScenarioOperations[name],
      evidence: { model: "available", "provider-http": "available", runtime: "unsupported" } as const,
      ...(name === "docker" ? { providerHttpRequirements: ["Docker CLI on PATH"] } : {})
    }))
  };
}
