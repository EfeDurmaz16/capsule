import { sha256 } from "./artifacts.js";
import type { Artifact, CapsulePolicy, CapsuleReceipt, LogEntry, ProviderOptions, SupportLevel } from "./types.js";

const evidenceBundleSchema = "capsule.evidence.bundle.v1" as const;

interface EvidencePolicyDecision {
  receiptId: string;
  type: CapsuleReceipt["type"];
  capabilityPath: string;
  decision: "allowed" | "denied";
  applied: CapsulePolicy;
  notes?: string[];
}

interface EvidenceProviderMetadata {
  receiptId: string;
  provider: string;
  adapter: string;
  capabilityPath: string;
  supportLevel: SupportLevel;
  resource?: CapsuleReceipt["resource"];
  metadata?: CapsuleReceipt["metadata"];
  providerOptions?: ProviderOptions;
}

export interface EvidenceBundle {
  schema: typeof evidenceBundleSchema;
  createdAt: string;
  receipts: CapsuleReceipt[];
  logs: LogEntry[];
  artifacts: Artifact[];
  policyDecisions: EvidencePolicyDecision[];
  providerMetadata: EvidenceProviderMetadata[];
  digest: {
    algorithm: "sha256";
    value: string;
  };
}

export interface CreateEvidenceBundleInput {
  receipts: readonly CapsuleReceipt[];
  logs?: readonly LogEntry[];
  artifacts?: readonly Artifact[];
  createdAt?: Date | string;
}

export interface EvidenceBundleVerificationResult {
  valid: boolean;
  reason?: "digest-algorithm-mismatch" | "digest-mismatch";
  expectedDigest?: string;
  actualDigest?: string;
}

export function createEvidenceBundle(input: CreateEvidenceBundleInput): EvidenceBundle {
  const payload: Omit<EvidenceBundle, "digest"> = {
    schema: evidenceBundleSchema,
    createdAt: normalizeBundleTimestamp(input.createdAt),
    receipts: [...input.receipts],
    logs: [...(input.logs ?? [])],
    artifacts: [...(input.artifacts ?? [])],
    policyDecisions: input.receipts.map((receipt) => ({
      receiptId: receipt.id,
      type: receipt.type,
      capabilityPath: receipt.capabilityPath,
      decision: receipt.policy.decision,
      applied: receipt.policy.applied,
      notes: receipt.policy.notes
    })),
    providerMetadata: input.receipts.map((receipt) => ({
      receiptId: receipt.id,
      provider: receipt.provider,
      adapter: receipt.adapter,
      capabilityPath: receipt.capabilityPath,
      supportLevel: receipt.supportLevel,
      resource: receipt.resource,
      metadata: receipt.metadata,
      providerOptions: receipt.providerOptions
    }))
  };
  return {
    ...payload,
    digest: {
      algorithm: "sha256",
      value: sha256(canonicalEvidenceBundlePayload(payload))
    }
  };
}

function canonicalEvidenceBundlePayload(bundle: EvidenceBundle | Omit<EvidenceBundle, "digest">): string {
  const { digest: _digest, ...payload } = bundle as EvidenceBundle;
  return canonicalJson(payload);
}

export function verifyEvidenceBundle(bundle: EvidenceBundle): EvidenceBundleVerificationResult {
  if (bundle.digest.algorithm !== "sha256") {
    return { valid: false, reason: "digest-algorithm-mismatch" };
  }
  const actualDigest = sha256(canonicalEvidenceBundlePayload(bundle));
  if (actualDigest !== bundle.digest.value) {
    return {
      valid: false,
      reason: "digest-mismatch",
      expectedDigest: bundle.digest.value,
      actualDigest
    };
  }
  return { valid: true };
}

function normalizeBundleTimestamp(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter((entry) => entry[1] !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}
