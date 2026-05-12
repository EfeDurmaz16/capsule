import { PolicyViolationError } from "./errors.js";
import type { CapsulePolicy } from "./types.js";

export interface PolicyDecision {
  decision: "allowed" | "denied";
  applied: CapsulePolicy;
  notes: string[];
}

export interface PolicyInput {
  env?: Record<string, string>;
  timeoutMs?: number;
}

export function evaluatePolicy(policy: CapsulePolicy = {}, input: PolicyInput = {}): PolicyDecision {
  const notes: string[] = [];

  if (policy.approvals?.required) {
    notes.push(`Approval required: ${policy.approvals.reason ?? "no reason provided"}`);
  }

  if (policy.secrets && input.env) {
    const allowed = new Set(policy.secrets.allowed ?? []);
    const denied = Object.keys(input.env).filter((key) => !allowed.has(key));
    if (denied.length > 0) {
      throw new PolicyViolationError(`Environment keys denied by secrets policy: ${denied.join(", ")}`, denied);
    }
  }

  if (policy.limits?.timeoutMs !== undefined && input.timeoutMs !== undefined && input.timeoutMs > policy.limits.timeoutMs) {
    notes.push(`Requested timeout ${input.timeoutMs}ms reduced to policy maximum ${policy.limits.timeoutMs}ms`);
  }

  if (policy.network?.mode === "allowlist") {
    notes.push("Network allowlist enforcement depends on adapter/provider support");
  }

  return {
    decision: "allowed",
    applied: policy,
    notes
  };
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
