import type { CapsuleApprovalGrant } from "@capsule-sdk/core";
import { Refusal, isPlainObject } from "./validate.js";
import { ACTIONS, type BridgeAction, type CapabilityProfile } from "./wire.js";

// Worker configuration: the scope the worker is bound to, the worker's own policy and the approval
// grants it can resolve by ref. The shape is the `provider_state` of the shared scenarios minus the
// fixture provider's own state (sandboxes and script), so a scenario's state is also a valid config.

export interface WorkerPolicy {
  /** Images sandbox.create may use. Absent: any image. */
  images?: string[];
  /** The worker's secrets block. Present with `allowed` omitted denies every secret. */
  secrets?: { allowed?: string[] };
}

export interface WorkerApproval {
  ref: string;
  action: BridgeAction;
  /** The one resource the grant covers, or null for a grant not tied to a resource (for example a create). */
  native_id: string | null;
  /** A fixed expiry flag, as the fixture scenarios use. */
  expired?: boolean;
  /** An ISO 8601 expiry. A grant past it authorizes nothing. */
  expires_at?: string;
}

export interface WorkerConfig {
  /** The scope every locator of this worker must carry, keyed by the profile's scope_keys. */
  binding?: Record<string, string>;
  policy: WorkerPolicy;
  approvals: WorkerApproval[];
  /** Fixture provider state; only the fixture profile reads these. */
  sandboxes?: unknown[];
  script?: unknown[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new ConfigError(`${what} must be an array of strings`);
  return value as string[];
}

/** Parses and checks a worker config document for `profile`. Unknown fields are refused. */
export function parseWorkerConfig(value: unknown, profile: CapabilityProfile): WorkerConfig {
  if (!isPlainObject(value)) throw new ConfigError("config must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!["binding", "policy", "approvals", "sandboxes", "script"].includes(key)) throw new ConfigError(`config has unknown field ${key}`);
  }
  const config: WorkerConfig = { policy: {}, approvals: [] };
  if (value.binding !== undefined) {
    if (!isPlainObject(value.binding)) throw new ConfigError("binding must be an object");
    const keys = Object.keys(value.binding).sort();
    if (keys.join(",") !== [...profile.scope_keys].sort().join(",")) {
      throw new ConfigError(`binding keys must be exactly ${profile.scope_keys.join(", ")}`);
    }
    for (const [key, entry] of Object.entries(value.binding)) {
      if (typeof entry !== "string" || entry.length < 1 || entry.length > 512) throw new ConfigError(`binding.${key} must be 1 to 512 characters`);
    }
    config.binding = value.binding as Record<string, string>;
  }
  if (value.policy !== undefined) {
    if (!isPlainObject(value.policy)) throw new ConfigError("policy must be an object");
    for (const key of Object.keys(value.policy)) if (!["images", "secrets"].includes(key)) throw new ConfigError(`policy has unknown field ${key}`);
    if (value.policy.images !== undefined) config.policy.images = strings(value.policy.images, "policy.images");
    if (value.policy.secrets !== undefined) {
      const secrets = value.policy.secrets;
      if (!isPlainObject(secrets) || Object.keys(secrets).some((key) => key !== "allowed")) throw new ConfigError("policy.secrets may hold only allowed");
      config.policy.secrets = secrets.allowed === undefined ? {} : { allowed: strings(secrets.allowed, "policy.secrets.allowed") };
    }
  }
  if (value.approvals !== undefined) {
    if (!Array.isArray(value.approvals)) throw new ConfigError("approvals must be an array");
    config.approvals = value.approvals.map((entry, index) => parseApproval(entry, index));
  }
  if (value.sandboxes !== undefined || value.script !== undefined) {
    if (profile.profile !== "fixture") throw new ConfigError("sandboxes and script configure the fixture provider only");
    if (value.sandboxes !== undefined && !Array.isArray(value.sandboxes)) throw new ConfigError("sandboxes must be an array");
    if (value.script !== undefined && !Array.isArray(value.script)) throw new ConfigError("script must be an array");
    config.sandboxes = (value.sandboxes as unknown[] | undefined) ?? [];
    config.script = (value.script as unknown[] | undefined) ?? [];
  }
  return config;
}

function parseApproval(value: unknown, index: number): WorkerApproval {
  const what = `approvals[${index}]`;
  if (!isPlainObject(value)) throw new ConfigError(`${what} must be an object`);
  for (const key of Object.keys(value)) {
    if (!["ref", "action", "native_id", "expired", "expires_at"].includes(key)) throw new ConfigError(`${what} has unknown field ${key}`);
  }
  if (typeof value.ref !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.ref)) throw new ConfigError(`${what}.ref is not a valid ref`);
  if (typeof value.action !== "string" || !(ACTIONS as readonly string[]).includes(value.action)) throw new ConfigError(`${what}.action is not a v1 action`);
  if (value.native_id !== null && typeof value.native_id !== "string") throw new ConfigError(`${what}.native_id must be a string or null`);
  if (value.expired !== undefined && typeof value.expired !== "boolean") throw new ConfigError(`${what}.expired must be a boolean`);
  if (value.expires_at !== undefined && (typeof value.expires_at !== "string" || Number.isNaN(Date.parse(value.expires_at)))) {
    throw new ConfigError(`${what}.expires_at must be an ISO 8601 time`);
  }
  return {
    ref: value.ref,
    action: value.action as BridgeAction,
    native_id: value.native_id as string | null,
    ...(value.expired === undefined ? {} : { expired: value.expired as boolean }),
    ...(value.expires_at === undefined ? {} : { expires_at: value.expires_at as string })
  };
}

/**
 * Resolves an approval ref for one action on one resource into a Capsule grant scoped to exactly that
 * capability and resource, or refuses with the v1 reason. A grant never stretches: a create grant
 * never authorizes destroy, a grant for one sandbox never covers another, an expired grant covers
 * nothing. The ref itself is a name, never a credential, and is not logged.
 */
export function resolveApproval(
  config: WorkerConfig,
  ref: string,
  action: BridgeAction,
  provider: string,
  nativeId: string | undefined,
  now: Date
): CapsuleApprovalGrant {
  const approval = config.approvals.find((entry) => entry.ref === ref);
  if (!approval) throw new Refusal("denied", "approval_required", "the approval ref names no grant this worker holds");
  if (approval.action !== action || (approval.native_id !== null && approval.native_id !== nativeId)) {
    throw new Refusal("denied", "approval_scope", "the grant does not cover this action on this resource");
  }
  if (approval.expired === true || (approval.expires_at !== undefined && Date.parse(approval.expires_at) <= now.getTime())) {
    throw new Refusal("denied", "approval_expired", "the grant has expired");
  }
  // The ref stays out of the grant: Capsule records a grant's id in policy notes and receipts.
  return {
    approved: true,
    reason: "fresh per-operation bridge approval",
    capabilities: [action],
    ...(approval.native_id === null ? {} : { resources: [{ type: "sandbox", id: approval.native_id, provider }] }),
    ...(approval.expires_at === undefined ? {} : { expiresAt: approval.expires_at })
  };
}
