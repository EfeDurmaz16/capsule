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

export interface SupportLevelExplanation {
  path: CapabilityPath;
  level: SupportLevel;
  supported: boolean;
  summary: string;
  guidance: string;
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

export function explainSupportLevel(capabilities: CapabilityMap, path: CapabilityPath): SupportLevelExplanation {
  const level = supportLevel(capabilities, path);
  const supported = level !== "unsupported";

  return {
    path,
    level,
    supported,
    summary: supportLevelSummary(level),
    guidance: supportLevelGuidance(path, level)
  };
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

function supportLevelSummary(level: SupportLevel): string {
  if (level === "native") return "The adapter/provider declares first-class support for this capability.";
  if (level === "emulated") return "Capsule can provide this capability through adapter-side behavior, not provider-native semantics.";
  if (level === "experimental") return "The adapter/provider exposes this capability, but behavior may still change or be incomplete.";
  return "The adapter/provider does not support this capability.";
}

function supportLevelGuidance(path: CapabilityPath, level: SupportLevel): string {
  if (level === "native") return `${path} can be used without Capsule-side emulation warnings.`;
  if (level === "emulated") return `${path} should be used only when adapter-side emulation is acceptable for the workflow.`;
  if (level === "experimental") return `${path} should be gated behind explicit opt-in, tests, or provider-specific checks.`;
  return `Choose another adapter, change the workflow requirements, or use a provider-specific escape hatch for ${path}.`;
}
