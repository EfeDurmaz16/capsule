import type { CapabilityMap, SupportLevel } from "./types.js";

export type CapabilityPath = `${string}.${string}`;

export function supportLevel(capabilities: CapabilityMap, path: CapabilityPath): SupportLevel {
  const [domain, key] = path.split(".");
  const domainCapabilities = capabilities[domain as keyof CapabilityMap] as Record<string, SupportLevel | undefined> | undefined;
  return domainCapabilities?.[key] ?? "unsupported";
}

export function supports(capabilities: CapabilityMap, path: CapabilityPath): boolean {
  return supportLevel(capabilities, path) !== "unsupported";
}
