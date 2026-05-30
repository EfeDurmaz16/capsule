import { sha256 } from "./artifacts.js";

const capsuleOperationTagKeys = {
  key: "capsule_operation_key",
  scope: "capsule_operation_scope"
} as const;

interface CapsuleOperationTagInput {
  idempotencyKey?: string;
  idempotencyScope?: string;
  capabilityPath: string;
}

export function capsuleOperationTag(input: CapsuleOperationTagInput): string | undefined {
  if (!input.idempotencyKey) {
    return undefined;
  }
  const scope = input.idempotencyScope ?? input.capabilityPath;
  return sha256(`${scope}\0${input.idempotencyKey}`).slice(0, 32);
}

export function capsuleOperationTags(input: CapsuleOperationTagInput): Record<string, string> | undefined {
  const tag = capsuleOperationTag(input);
  if (!tag) {
    return undefined;
  }
  return {
    [capsuleOperationTagKeys.key]: tag,
    [capsuleOperationTagKeys.scope]: normalizeOperationScope(input.idempotencyScope ?? input.capabilityPath)
  };
}

function normalizeOperationScope(scope: string): string {
  return scope.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/^[^a-z0-9]+/, "").slice(0, 63) || "operation";
}
