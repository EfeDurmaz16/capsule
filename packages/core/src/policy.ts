import { PolicyViolationError } from "./errors.js";
import type {
  CapsuleApprovalGrant,
  CapsuleApprovalResourceScope,
  CapsulePolicy,
  LogEntry,
  PolicyCostDecision,
  PolicyEnforcement,
  PolicyNetworkDecision,
  PolicyTraceEntry,
  PolicyTtlDecision,
  SupportLevel
} from "./types.js";

export const credentialTokenPatternSource =
  "(?<=\\bBearer\\s+)\\S+|\\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\\b|\\bgh[pousr]_[A-Za-z0-9_]{20,}\\b|\\bxox[baprs]-[A-Za-z0-9-]{20,}\\b|\\beyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b|\\bAKIA[A-Z0-9]{16}\\b|\\bpostgres(?:ql)?:\\/\\/[^\\s]+|\\bpassword=[^\\s&]+";
const credentialTokenValue = new RegExp(credentialTokenPatternSource, "gi");
const broadTokenLikeValue = /\b[A-Za-z0-9_-]{48,}\b/g;
const defaultSensitiveKey = /(api[-_]?key|auth|credential|password|private[-_]?key|secret|token)/i;

export interface PolicyDecision {
  decision: "allowed" | "denied";
  applied: CapsulePolicy;
  notes: string[];
  enforcement: PolicyEnforcement;
  trace: PolicyTraceEntry[];
  cost?: PolicyCostDecision;
  ttl?: PolicyTtlDecision;
  network?: PolicyNetworkDecision;
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
  costUsd?: number;
  approval?: CapsuleApprovalGrant;
  capabilityPath?: string;
  supportLevel?: SupportLevel;
  networkPolicySupport?: SupportLevel;
  enforcement?: PolicyEnforcement;
  resource?: CapsuleApprovalResourceScope;
  now?: Date;
}

export function evaluatePolicy(policy: CapsulePolicy = {}, input: PolicyInput = {}): PolicyDecision {
  const notes: string[] = [];
  const trace: PolicyTraceEntry[] = [];

  const network = networkDecision(policy, input);

  if (policy.network?.mode === "none") {
    notes.push("Network policy requested mode=none; enforcement is native only when the adapter/provider explicitly supports network isolation.");
    trace.push({ check: "network", verdict: "noted" });
  }

  if (policy.network?.mode === "allowlist") {
    notes.push("Network allowlist policy requested; enforcement is adapter/provider-specific and may be unsupported or best-effort.");
    trace.push({ check: "network", verdict: "noted" });
  }

  if (policy.filesystem) {
    notes.push("Filesystem policy requested; enforcement may be native, emulated at the adapter boundary, or unsupported depending on the runtime.");
    trace.push({ check: "filesystem", verdict: "noted" });
  }

  if (input.capabilityPath && input.supportLevel) {
    notes.push(`Adapter support level for ${input.capabilityPath}: ${input.supportLevel}.`);
    trace.push({ check: "support-level", verdict: "noted" });
  }

  if (policy.approvals?.required) {
    if (!input.approval?.approved) {
      throw new PolicyViolationError(`Approval required by policy: ${policy.approvals.reason ?? "no reason provided"}`, [
        policy.approvals.reason ?? "approval required"
      ]);
    }
    validateApprovalGrant(input.approval, input);
    notes.push(`Approval satisfied: ${input.approval.id ?? input.approval.reason ?? policy.approvals.reason ?? "no reason provided"}`);
    trace.push({ check: "approval", verdict: "passed" });
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
    trace.push({ check: "secrets", verdict: "passed" });
    if (policy.secrets.redactFromLogs) {
      notes.push("Secret redaction is applied to Capsule-observed stdout, stderr, and log entries; provider-side logs may need separate controls.");
    }
  }

  if (policy.limits?.timeoutMs !== undefined && input.timeoutMs !== undefined && input.timeoutMs > policy.limits.timeoutMs) {
    notes.push(`Requested timeout ${input.timeoutMs}ms reduced to policy maximum ${policy.limits.timeoutMs}ms`);
    trace.push({ check: "limits.timeout", verdict: "noted" });
  }

  if (policy.limits?.memoryMb !== undefined || policy.limits?.cpu !== undefined) {
    notes.push("CPU and memory limits are delegated to adapter/provider support; Capsule does not claim OS-level enforcement by itself.");
    trace.push({ check: "limits.resources", verdict: "noted" });
  }

  const cost = costDecision(policy, input);
  if (cost) {
    notes.push("Cost policy is a control-plane constraint; provider billing enforcement is not guaranteed by Capsule.");
    trace.push({ check: "cost", verdict: "noted" });
  }

  const ttl = ttlDecision(policy, input);
  if (policy.ttl?.maxMs !== undefined && input.ttlMs !== undefined) {
    if (input.ttlMs > policy.ttl.maxMs) {
      throw new PolicyViolationError(`Requested TTL ${input.ttlMs}ms exceeds policy maximum ${policy.ttl.maxMs}ms`, ["ttlMs"]);
    }
    notes.push(`TTL policy maximum ${policy.ttl.maxMs}ms applies to this request.`);
    trace.push({ check: "ttl", verdict: "passed" });
  } else if (policy.ttl?.maxMs !== undefined) {
    notes.push("TTL policy is a control-plane cleanup constraint; cleanup depends on adapter/provider lifecycle support.");
    trace.push({ check: "ttl", verdict: "noted" });
  }

  return {
    decision: "allowed",
    applied: policy,
    notes,
    enforcement: deriveEnforcement(input),
    trace,
    ...(cost ? { cost } : {}),
    ...(ttl ? { ttl } : {}),
    ...(network ? { network } : {})
  };
}

function deriveEnforcement(input: PolicyInput): PolicyEnforcement {
  if (input.enforcement) {
    return input.enforcement;
  }
  if (input.supportLevel === "unsupported") {
    return "unsupported";
  }
  if (input.supportLevel === "native") {
    return "native";
  }
  return "delegated";
}

function costDecision(policy: CapsulePolicy, input: PolicyInput): PolicyCostDecision | undefined {
  if (policy.cost?.maxUsd === undefined) {
    return undefined;
  }
  const limitUsd = policy.cost.maxUsd;
  return {
    ...(input.costUsd === undefined ? {} : { requestedUsd: input.costUsd }),
    limitUsd,
    withinLimit: input.costUsd === undefined || input.costUsd <= limitUsd
  };
}

function ttlDecision(policy: CapsulePolicy, input: PolicyInput): PolicyTtlDecision | undefined {
  if (policy.ttl?.maxMs === undefined) {
    return undefined;
  }
  const limitMs = policy.ttl.maxMs;
  return {
    ...(input.ttlMs === undefined ? {} : { requestedMs: input.ttlMs }),
    limitMs,
    withinLimit: input.ttlMs === undefined || input.ttlMs <= limitMs
  };
}

function networkDecision(policy: CapsulePolicy, input: PolicyInput): PolicyNetworkDecision | undefined {
  if (!policy.network) {
    return undefined;
  }
  const mode = policy.network.mode;
  return {
    mode,
    support: input.networkPolicySupport ?? "unknown",
    hosts: (policy.network.allowedHosts ?? []).map((host) => ({ host, allowed: mode !== "none" }))
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
        enforcement: deriveEnforcement(input),
        trace: [{ check: error.notes[0] ?? "policy", verdict: "denied" }],
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
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is scoped to capabilities but this operation has no capability path`, [
        "approval.capabilities"
      ]);
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
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is scoped to resources but this operation has no resource hint`, [
        "approval.resources"
      ]);
    }
    if (!approval.resources.some((resource) => approvalResourceMatches(resource, input.resource!))) {
      throw new PolicyViolationError(`Approval grant ${approvalLabel(approval)} is not valid for resource ${formatApprovalResource(input.resource)}`, [
        "approval.resources"
      ]);
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

/**
 * Merge two policies, always failing toward the stricter side.
 *
 * Per-field rules:
 * - network.mode: the stricter mode wins (none > allowlist > all); an undeclared side is treated as unrestricted.
 * - network.allowedHosts: intersected when both sides declare an allowlist; otherwise the declared list is kept.
 * - secrets.allowed: when both sides declare a secrets block, their effective allowlists are intersected. A block that
 *   omits `allowed` denies every env key, so it counts as an empty allowlist and the merge stays deny-all.
 * - secrets.redactFromLogs: OR toward safety (either side asking to redact wins).
 * - secrets.redactionProfile: strict wins over standard.
 * - secrets.redactKeys: union.
 * - filesystem.read / filesystem.write: intersected when both declare a list; otherwise the declared list is kept.
 * - limits.* / cost.maxUsd / ttl.maxMs: the smaller (stricter) declared value wins.
 * - approvals.required: OR toward safety.
 */
export function mergePolicy(base: CapsulePolicy = {}, override: CapsulePolicy = {}): CapsulePolicy {
  const merged: CapsulePolicy = {};

  const network = mergeNetwork(base.network, override.network);
  if (network) {
    merged.network = network;
  }

  const filesystem = mergeFilesystem(base.filesystem, override.filesystem);
  if (filesystem) {
    merged.filesystem = filesystem;
  }

  const secrets = mergeSecrets(base.secrets, override.secrets);
  if (secrets) {
    merged.secrets = secrets;
  }

  const limits = mergeLimits(base.limits, override.limits);
  if (limits) {
    merged.limits = limits;
  }

  const maxUsd = minDefined(base.cost?.maxUsd, override.cost?.maxUsd);
  if (maxUsd !== undefined) {
    merged.cost = { maxUsd };
  }

  const maxMs = minDefined(base.ttl?.maxMs, override.ttl?.maxMs);
  if (maxMs !== undefined) {
    merged.ttl = { maxMs };
  }

  const approvals = mergeApprovals(base.approvals, override.approvals);
  if (approvals) {
    merged.approvals = approvals;
  }

  return merged;
}

const networkStrictness: Record<NonNullable<CapsulePolicy["network"]>["mode"], number> = { none: 3, allowlist: 2, all: 1 };

function mergeNetwork(base: CapsulePolicy["network"], override: CapsulePolicy["network"]): CapsulePolicy["network"] {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  const mode = networkStrictness[base.mode] >= networkStrictness[override.mode] ? base.mode : override.mode;
  const allowedHosts =
    base.allowedHosts && override.allowedHosts ? intersect(base.allowedHosts, override.allowedHosts) : (base.allowedHosts ?? override.allowedHosts);
  return { mode, ...(allowedHosts ? { allowedHosts } : {}) };
}

function mergeFilesystem(base: CapsulePolicy["filesystem"], override: CapsulePolicy["filesystem"]): CapsulePolicy["filesystem"] {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  const read = base.read && override.read ? intersect(base.read, override.read) : (base.read ?? override.read);
  const write = base.write && override.write ? intersect(base.write, override.write) : (base.write ?? override.write);
  return { ...(read ? { read } : {}), ...(write ? { write } : {}) };
}

function mergeSecrets(base: CapsulePolicy["secrets"], override: CapsulePolicy["secrets"]): CapsulePolicy["secrets"] {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  // A present secrets block without `allowed` denies every env key (see evaluatePolicy), so its
  // effective allowlist is []. Intersect effective allowlists so a merge never widens either side.
  const allowed = base.allowed || override.allowed ? intersect(base.allowed ?? [], override.allowed ?? []) : undefined;
  const redactFromLogs = Boolean(base.redactFromLogs) || Boolean(override.redactFromLogs);
  const redactionProfile: "standard" | "strict" | undefined =
    base.redactionProfile === "strict" || override.redactionProfile === "strict" ? "strict" : (base.redactionProfile ?? override.redactionProfile);
  const redactKeys = union(base.redactKeys, override.redactKeys);
  return {
    ...(allowed ? { allowed } : {}),
    ...(redactFromLogs ? { redactFromLogs } : {}),
    ...(redactionProfile ? { redactionProfile } : {}),
    ...(redactKeys ? { redactKeys } : {})
  };
}

function mergeLimits(base: CapsulePolicy["limits"], override: CapsulePolicy["limits"]): CapsulePolicy["limits"] {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  const limits: NonNullable<CapsulePolicy["limits"]> = {};
  for (const key of ["timeoutMs", "maxStdoutBytes", "maxStderrBytes", "memoryMb", "cpu"] as const) {
    const value = minDefined(base[key], override[key]);
    if (value !== undefined) {
      limits[key] = value;
    }
  }
  return limits;
}

function mergeApprovals(base: CapsulePolicy["approvals"], override: CapsulePolicy["approvals"]): CapsulePolicy["approvals"] {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  const required = Boolean(base.required) || Boolean(override.required);
  const reason = override.reason ?? base.reason;
  return { ...(required ? { required } : {}), ...(reason ? { reason } : {}) };
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Math.min(a, b);
}

function intersect(a: string[], b: string[]): string[] {
  const other = new Set(b);
  return a.filter((value) => other.has(value));
}

function union(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a && !b) {
    return undefined;
  }
  return [...new Set([...(a ?? []), ...(b ?? [])])];
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
  const redacted = value.replace(credentialTokenValue, "[REDACTED]");
  if (policy.secrets?.redactionProfile !== "strict") {
    return redacted;
  }
  return redacted.replace(broadTokenLikeValue, "[REDACTED]");
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
