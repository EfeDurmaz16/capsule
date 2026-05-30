import { PolicyViolationError } from "./errors.js";
import type { CapsuleApprovalGrant, CapsuleApprovalResourceScope, CapsulePolicy, LogEntry, SupportLevel } from "./types.js";

const tokenLikeValue =
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\b[A-Za-z0-9_-]{48,}\b/g;
const defaultSensitiveKey = /(api[-_]?key|auth|credential|password|private[-_]?key|secret|token)/i;

export interface PolicyDecision {
  decision: "allowed" | "denied";
  applied: CapsulePolicy;
  notes: string[];
}

export interface PolicyExplanation extends PolicyDecision {
  input: PolicyExplanationInput;
  violations: string[];
  reason?: string;
}

export interface PolicyExplanationInput {
  capabilityPath?: string;
  supportLevel?: SupportLevel;
  envKeys?: string[];
  timeoutMs?: number;
  ttlMs?: number;
  approval?: {
    approved: boolean;
    id?: string;
    approver?: string;
    reason?: string;
    approvedAt?: string;
    expiresAt?: string;
    capabilities?: string[];
    resources?: CapsuleApprovalResourceScope[];
  };
  resource?: CapsuleApprovalResourceScope;
  now?: string;
}

export interface PolicyInput {
  env?: Record<string, string>;
  timeoutMs?: number;
  ttlMs?: number;
  approval?: CapsuleApprovalGrant;
  capabilityPath?: string;
  supportLevel?: SupportLevel;
  resource?: CapsuleApprovalResourceScope;
  now?: Date;
}

export function evaluatePolicy(policy: CapsulePolicy = {}, input: PolicyInput = {}): PolicyDecision {
  const notes: string[] = [];

  if (policy.network?.mode === "none") {
    notes.push("Network policy requested mode=none; enforcement is native only when the adapter/provider explicitly supports network isolation.");
  }

  if (policy.network?.mode === "allowlist") {
    notes.push("Network allowlist policy requested; enforcement is adapter/provider-specific and may be unsupported or best-effort.");
  }

  if (policy.filesystem) {
    notes.push("Filesystem policy requested; enforcement may be native, emulated at the adapter boundary, or unsupported depending on the runtime.");
  }

  if (input.capabilityPath && input.supportLevel) {
    notes.push(`Adapter support level for ${input.capabilityPath}: ${input.supportLevel}.`);
  }

  if (policy.approvals?.required) {
    if (!input.approval?.approved) {
      throw new PolicyViolationError(`Approval required by policy: ${policy.approvals.reason ?? "no reason provided"}`, [
        policy.approvals.reason ?? "approval required"
      ]);
    }
    validateApprovalGrant(input.approval, input);
    notes.push(`Approval satisfied: ${input.approval.id ?? input.approval.reason ?? policy.approvals.reason ?? "no reason provided"}`);
    if (input.approval.capabilities !== undefined) {
      notes.push(`Approval capability scope satisfied: ${input.capabilityPath}`);
    }
    if (input.approval.resources !== undefined) {
      notes.push(`Approval resource scope satisfied: ${formatApprovalResource(input.resource)}`);
    }
  }

  if (policy.secrets && input.env) {
    const allowed = new Set(policy.secrets.allowed ?? []);
    const denied = Object.keys(input.env).filter((key) => !allowed.has(key));
    if (denied.length > 0) {
      throw new PolicyViolationError(`Environment keys denied by secrets policy: ${denied.join(", ")}`, denied);
    }
    if (policy.secrets.redactFromLogs) {
      notes.push("Secret redaction is applied to Capsule-observed stdout, stderr, and log entries; provider-side logs may need separate controls.");
    }
  }

  if (policy.limits?.timeoutMs !== undefined && input.timeoutMs !== undefined && input.timeoutMs > policy.limits.timeoutMs) {
    notes.push(`Requested timeout ${input.timeoutMs}ms reduced to policy maximum ${policy.limits.timeoutMs}ms`);
  }

  if (policy.limits?.memoryMb !== undefined || policy.limits?.cpu !== undefined) {
    notes.push("CPU and memory limits are delegated to adapter/provider support; Capsule does not claim OS-level enforcement by itself.");
  }

  if (policy.cost?.maxUsd !== undefined) {
    notes.push("Cost policy is a control-plane constraint; provider billing enforcement is not guaranteed by Capsule.");
  }

  if (policy.ttl?.maxMs !== undefined && input.ttlMs !== undefined) {
    if (input.ttlMs > policy.ttl.maxMs) {
      throw new PolicyViolationError(`Requested TTL ${input.ttlMs}ms exceeds policy maximum ${policy.ttl.maxMs}ms`, ["ttlMs"]);
    }
    notes.push(`TTL policy maximum ${policy.ttl.maxMs}ms applies to this request.`);
  } else if (policy.ttl?.maxMs !== undefined) {
    notes.push("TTL policy is a control-plane cleanup constraint; cleanup depends on adapter/provider lifecycle support.");
  }

  return {
    decision: "allowed",
    applied: policy,
    notes
  };
}

export function explainPolicy(policy: CapsulePolicy = {}, input: PolicyInput = {}): PolicyExplanation {
  try {
    const decision = evaluatePolicy(policy, input);
    return {
      ...decision,
      input: summarizePolicyInput(input),
      violations: []
    };
  } catch (error) {
    if (error instanceof PolicyViolationError) {
      return {
        decision: "denied",
        applied: policy,
        input: summarizePolicyInput(input),
        notes: [],
        reason: error.message,
        violations: error.notes
      };
    }
    throw error;
  }
}

function summarizePolicyInput(input: PolicyInput): PolicyExplanationInput {
  return {
    ...(input.capabilityPath === undefined ? {} : { capabilityPath: input.capabilityPath }),
    ...(input.supportLevel === undefined ? {} : { supportLevel: input.supportLevel }),
    ...(input.env === undefined ? {} : { envKeys: Object.keys(input.env).sort() }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
    ...(input.approval === undefined
      ? {}
      : {
          approval: {
            approved: input.approval.approved,
            ...(input.approval.id === undefined ? {} : { id: input.approval.id }),
            ...(input.approval.approver === undefined ? {} : { approver: input.approval.approver }),
            ...(input.approval.reason === undefined ? {} : { reason: input.approval.reason }),
            ...(input.approval.approvedAt === undefined ? {} : { approvedAt: input.approval.approvedAt }),
            ...(input.approval.expiresAt === undefined ? {} : { expiresAt: input.approval.expiresAt }),
            ...(input.approval.capabilities === undefined ? {} : { capabilities: input.approval.capabilities }),
            ...(input.approval.resources === undefined ? {} : { resources: input.approval.resources })
          }
        }),
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.now === undefined ? {} : { now: input.now.toISOString() })
  };
}

function validateApprovalGrant(approval: CapsuleApprovalGrant, input: PolicyInput): void {
  const now = input.now ?? new Date();

  if (approval.expiresAt !== undefined) {
    const expiresAt = new Date(approval.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} has an invalid expiresAt timestamp`, ["approval.expiresAt"]);
    }
    if (expiresAt.getTime() <= now.getTime()) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} expired at ${approval.expiresAt}`, ["approval.expiresAt"]);
    }
  }

  if (approval.capabilities !== undefined) {
    if (approval.capabilities.length === 0) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} has no allowed capabilities`, ["approval.capabilities"]);
    }
    if (!input.capabilityPath) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is scoped to capabilities but this operation has no capability path`, ["approval.capabilities"]);
    }
    if (!approval.capabilities.includes(input.capabilityPath)) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is not valid for capability ${input.capabilityPath}`, [input.capabilityPath]);
    }
  }

  if (approval.resources !== undefined) {
    if (approval.resources.length === 0) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} has no allowed resources`, ["approval.resources"]);
    }
    if (!input.resource) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is scoped to resources but this operation has no resource hint`, ["approval.resources"]);
    }
    if (!approval.resources.some((resource) => approvalResourceMatches(resource, input.resource!))) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is not valid for resource ${formatApprovalResource(input.resource)}`, ["approval.resources"]);
    }
  }
}

function approvalResourceMatches(scope: CapsuleApprovalResourceScope, resource: CapsuleApprovalResourceScope): boolean {
  const entries = Object.entries(scope).filter((entry): entry is [keyof CapsuleApprovalResourceScope, string] => entry[1] !== undefined);
  if (entries.length === 0) {
    return false;
  }
  return entries.every(([key, value]) => resource[key] === value);
}

function approvalLabel(approval: CapsuleApprovalGrant): string {
  return approval.id ?? approval.reason ?? "unknown";
}

function formatApprovalResource(resource: CapsuleApprovalResourceScope | undefined): string {
  if (!resource) {
    return "unknown";
  }
  if (resource.type && resource.id) {
    return `${resource.type}:${resource.id}`;
  }
  if (resource.id) {
    return resource.id;
  }
  if (resource.type && resource.name) {
    return `${resource.type}:${resource.name}`;
  }
  if (resource.name) {
    return resource.name;
  }
  if (resource.project) {
    return `project:${resource.project}`;
  }
  if (resource.path) {
    return resource.path;
  }
  return "unknown";
}

export function mergeTimeout(policy: CapsulePolicy = {}, requested?: number): number | undefined {
  const policyTimeout = policy.limits?.timeoutMs;
  if (policyTimeout === undefined) {
    return requested;
  }
  if (requested === undefined) {
    return policyTimeout;
  }
  return Math.min(policyTimeout, requested);
}

export function redactSecrets(value: string, env: Record<string, string> | undefined, policy: CapsulePolicy = {}): string {
  return redactSensitiveText(value, env, policy);
}

export function redactSensitiveText(value: string, env: Record<string, string> | undefined, policy: CapsulePolicy = {}): string {
  if (!policy.secrets?.redactFromLogs || !env) {
    return redactTokenLikeText(value, policy);
  }
  let output = value;
  for (const key of policy.secrets.allowed ?? []) {
    const secret = env[key];
    if (secret) {
      output = output.split(secret).join("[REDACTED]");
    }
  }
  return redactTokenLikeText(output, policy);
}

export function isSensitiveKey(key: string, policy: CapsulePolicy = {}): boolean {
  if (defaultSensitiveKey.test(key)) {
    return true;
  }
  return (policy.secrets?.redactKeys ?? []).some((redactKey) => redactKey.toLowerCase() === key.toLowerCase());
}

export function redactError(error: unknown, env: Record<string, string> | undefined, policy: CapsulePolicy = {}): unknown {
  if (error instanceof Error) {
    const message = redactSensitiveText(error.message, env, policy);
    if (message !== error.message) {
      Object.defineProperty(error, "message", { value: message, configurable: true });
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      Object.defineProperty(error, "cause", { value: redactUnknownValue("cause", cause, env, policy), configurable: true });
    }
    return error;
  }
  if (typeof error === "string") {
    return redactSensitiveText(error, env, policy);
  }
  return redactUnknownValue("error", error, env, policy);
}

function redactTokenLikeText(value: string, policy: CapsulePolicy): string {
  if (policy.secrets?.redactionProfile !== "strict") {
    return value;
  }
  return value.replace(tokenLikeValue, "[REDACTED]");
}

function redactUnknownValue(key: string, value: unknown, env: Record<string, string> | undefined, policy: CapsulePolicy): unknown {
  if (isSensitiveKey(key, policy)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactSensitiveText(value, env, policy);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknownValue(key, item, env, policy));
  }
  if (value instanceof Error) {
    return redactError(value, env, policy);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactUnknownValue(childKey, childValue, env, policy)]));
  }
  return value;
}

export function redactLogEntries(logs: LogEntry[], env: Record<string, string> | undefined, policy: CapsulePolicy = {}): LogEntry[] {
  return logs.map((entry) => ({
    ...entry,
    message: redactSecrets(entry.message, env, policy)
  }));
}
