import type { CapabilityMap, SupportLevel } from "./types.js";

export type CapabilityPath = `${string}.${string}`;

export interface CapabilityRequirement {
  path: CapabilityPath;
  levels?: SupportLevel[];
  optional?: boolean;
  reason?: string;
}

export interface CapabilityRequirementResult {
  path: CapabilityPath;
  actualLevel: SupportLevel;
  acceptedLevels: SupportLevel[];
  supported: boolean;
  optional: boolean;
  reason?: string;
}

export interface CapabilityDiffEntry {
  path: CapabilityPath;
  left: SupportLevel;
  right: SupportLevel;
}

export type CapabilityRequirementInput = CapabilityPath | CapabilityRequirement;

export const deployableSupportLevels: SupportLevel[] = ["native", "emulated", "experimental"];
export const nativeOnlySupportLevels: SupportLevel[] = ["native"];

export function supportLevel(capabilities: CapabilityMap, path: CapabilityPath): SupportLevel {
  const [domain, key] = path.split(".");
  const domainCapabilities = capabilities[domain as keyof CapabilityMap] as Record<string, SupportLevel | undefined> | undefined;
  return domainCapabilities?.[key] ?? "unsupported";
}

export function supports(capabilities: CapabilityMap, path: CapabilityPath): boolean {
  return supportLevel(capabilities, path) !== "unsupported";
}

export function evaluateCapabilityRequirements(
  capabilities: CapabilityMap,
  requirements: CapabilityRequirementInput[]
): CapabilityRequirementResult[] {
  return requirements.map((requirement) => {
    const normalized = normalizeRequirement(requirement);
    const actualLevel = supportLevel(capabilities, normalized.path);
    const acceptedLevels = normalized.levels ?? deployableSupportLevels;

    return {
      path: normalized.path,
      actualLevel,
      acceptedLevels,
      supported: acceptedLevels.includes(actualLevel),
      optional: normalized.optional ?? false,
      reason: normalized.reason
    };
  });
}

export function missingCapabilityRequirements(
  capabilities: CapabilityMap,
  requirements: CapabilityRequirementInput[]
): CapabilityRequirementResult[] {
  return evaluateCapabilityRequirements(capabilities, requirements).filter((result) => !result.optional && !result.supported);
}

export function capabilityDiff(left: CapabilityMap, right: CapabilityMap, paths?: CapabilityPath[]): CapabilityDiffEntry[] {
  const capabilityPaths = paths ?? uniqueCapabilityPaths(left, right);

  return capabilityPaths
    .map((path) => ({
      path,
      left: supportLevel(left, path),
      right: supportLevel(right, path)
    }))
    .filter((entry) => entry.left !== entry.right);
}

export function uniqueCapabilityPaths(...maps: CapabilityMap[]): CapabilityPath[] {
  const paths = new Set<CapabilityPath>();

  for (const capabilities of maps) {
    for (const [domain, domainCapabilities] of Object.entries(capabilities)) {
      if (!domainCapabilities) continue;

      for (const key of Object.keys(domainCapabilities)) {
        paths.add(`${domain}.${key}` as CapabilityPath);
      }
    }
  }

  return [...paths].sort();
}

function normalizeRequirement(requirement: CapabilityRequirementInput): CapabilityRequirement {
  return typeof requirement === "string" ? { path: requirement } : requirement;
}
