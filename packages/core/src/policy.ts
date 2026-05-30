import { PolicyViolationError } from "./errors.js";
import type { CapsuleApprovalGrant, CapsuleApprovalResourceScope, CapsulePolicy, LogEntry } from "./types.js";

export interface PolicyDecision {
  decision: "allowed" | "denied";
  applied: CapsulePolicy;
  notes: string[];
}

export interface PolicyInput {
  env?: Record<string, string>;
  timeoutMs?: number;
  ttlMs?: number;
  approval?: CapsuleApprovalGrant;
  capabilityPath?: string;
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
  if (!policy.secrets?.redactFromLogs || !env) {
    return value;
  }
  let output = value;
  for (const key of policy.secrets.allowed ?? []) {
    const secret = env[key];
    if (secret) {
      output = output.split(secret).join("[REDACTED]");
    }
  }
  return output;
}

export function redactLogEntries(logs: LogEntry[], env: Record<string, string> | undefined, policy: CapsulePolicy = {}): LogEntry[] {
  return logs.map((entry) => ({
    ...entry,
    message: redactSecrets(entry.message, env, policy)
  }));
}
