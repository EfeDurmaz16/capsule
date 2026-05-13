import { PolicyViolationError } from "./errors.js";
import type { CapsulePolicy, LogEntry } from "./types.js";

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
    notes.push(`Approval required: ${policy.approvals.reason ?? "no reason provided"}`);
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

  if (policy.ttl?.maxMs !== undefined) {
    notes.push("TTL policy is a control-plane cleanup constraint; cleanup depends on adapter/provider lifecycle support.");
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

export function redactLogEntries(logs: LogEntry[], env: Record<string, string> | undefined, policy: CapsulePolicy = {}): LogEntry[] {
  return logs.map((entry) => ({
    ...entry,
    message: redactSecrets(entry.message, env, policy)
  }));
}
