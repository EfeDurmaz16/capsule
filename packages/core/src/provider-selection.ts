import {
  providerCompatibilityScore,
  type CapabilityRequirement,
  type CapabilityRequirementInput,
  type ProviderCompatibilityScore
} from "./capabilities.js";
import type { CapabilityMap } from "./types.js";

export const providerSelectionRecipeIds = ["sandbox", "agent-code-execution", "preview-web-db", "edge-web", "service-api", "machine"] as const;

export type ProviderSelectionRecipeId = (typeof providerSelectionRecipeIds)[number];

export interface ProviderSelectionRecipe {
  id: ProviderSelectionRecipeId;
  title: string;
  description: string;
  required: CapabilityRequirement[];
  optional: CapabilityRequirement[];
}

export interface ProviderSelectionCandidate {
  provider: string;
  capabilities: CapabilityMap;
  notes?: string[];
}

export interface ProviderSelectionResult extends ProviderCompatibilityScore {
  provider: string;
  capabilities: CapabilityMap;
  notes: string[];
}

export const providerSelectionRecipes: Readonly<Record<ProviderSelectionRecipeId, ProviderSelectionRecipe>> = {
  sandbox: {
    id: "sandbox",
    title: "Sandbox",
    description: "Short-lived sandbox lifecycle with command execution and basic file operations.",
    required: required(["sandbox.create", "sandbox.exec", "sandbox.fileRead", "sandbox.fileWrite", "sandbox.fileList", "sandbox.destroy"]),
    optional: optional(["sandbox.exposePort"])
  },
  "agent-code-execution": {
    id: "agent-code-execution",
    title: "Agent code execution",
    description: "Agent-facing code execution with explicit policy, secret, log, and artifact controls.",
    required: required(["sandbox.create", "sandbox.exec", "sandbox.fileWrite", "sandbox.fileRead", "sandbox.destroy"]),
    optional: optional([
      "sandbox.networkPolicy",
      "sandbox.filesystemPolicy",
      "sandbox.secretMounting",
      "sandbox.streamingLogs",
      "sandbox.artifacts",
      "sandbox.exposePort"
    ])
  },
  "preview-web-db": {
    id: "preview-web-db",
    title: "Preview web and database",
    description: "Ephemeral preview environments that can expose URLs and provision database branches.",
    required: required(["preview.create", "preview.destroy", "preview.urls", "database.branchCreate", "database.connectionString"]),
    optional: optional(["preview.status", "preview.logs", "preview.ttl", "preview.cleanup", "database.branchDelete", "database.migrate"])
  },
  "edge-web": {
    id: "edge-web",
    title: "Edge web",
    description: "Edge runtime deployment with route management.",
    required: required(["edge.deploy", "edge.routes"]),
    optional: optional(["edge.status", "edge.url", "edge.logs", "edge.version", "edge.release", "edge.rollback", "edge.bindings"])
  },
  "service-api": {
    id: "service-api",
    title: "Service API",
    description: "Long-running HTTP service deployment with status and URL discovery.",
    required: required(["service.deploy", "service.status", "service.url"]),
    optional: optional(["service.update", "service.delete", "service.logs", "service.scale", "service.rollback", "service.domains", "service.healthcheck", "service.secrets"])
  },
  machine: {
    id: "machine",
    title: "Machine",
    description: "Machine lifecycle for long-lived compute instances.",
    required: required(["machine.create", "machine.start", "machine.stop", "machine.destroy"]),
    optional: optional(["machine.status", "machine.exec", "machine.snapshot", "machine.volume", "machine.network"])
  }
};

export function getProviderSelectionRecipe(id: ProviderSelectionRecipeId): ProviderSelectionRecipe {
  return providerSelectionRecipes[id];
}

export function isProviderSelectionRecipeId(value: string): value is ProviderSelectionRecipeId {
  return (providerSelectionRecipeIds as readonly string[]).includes(value);
}

export function providerSelectionRequirements(recipe: ProviderSelectionRecipe): CapabilityRequirementInput[] {
  return [...recipe.required, ...recipe.optional];
}

export function rankProvidersByRecipe(candidates: ProviderSelectionCandidate[], recipeOrId: ProviderSelectionRecipeId | ProviderSelectionRecipe): ProviderSelectionResult[] {
  const recipe = typeof recipeOrId === "string" ? getProviderSelectionRecipe(recipeOrId) : recipeOrId;
  const requirements = providerSelectionRequirements(recipe);

  return candidates
    .map((candidate) => ({
      provider: candidate.provider,
      capabilities: candidate.capabilities,
      notes: candidate.notes ?? [],
      ...providerCompatibilityScore(candidate.capabilities, requirements)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.requiredSatisfied !== left.requiredSatisfied) return right.requiredSatisfied - left.requiredSatisfied;
      if (left.missingRequired.length !== right.missingRequired.length) return left.missingRequired.length - right.missingRequired.length;
      return left.provider.localeCompare(right.provider);
    });
}

function required(paths: CapabilityRequirement["path"][]): CapabilityRequirement[] {
  return paths.map((path) => ({ path }));
}

function optional(paths: CapabilityRequirement["path"][]): CapabilityRequirement[] {
  return paths.map((path) => ({ path, optional: true }));
}
