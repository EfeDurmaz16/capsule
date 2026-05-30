import { randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import { isSensitiveKey, redactSensitiveText } from "./policy.js";
import type { Artifact, CapsulePolicy, CapsuleReceipt, CapsuleReceiptMetadata, ProviderOptions, ProviderOptionValue, SupportLevel } from "./types.js";

export interface CreateReceiptInput {
  type: CapsuleReceipt["type"];
  provider: string;
  adapter: string;
  capabilityPath: string;
  supportLevel: SupportLevel;
  startedAt: Date;
  finishedAt?: Date;
  command?: string[];
  image?: string;
  source?: Record<string, unknown>;
  cwd?: string;
  providerOptions?: ProviderOptions;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  artifacts?: Artifact[];
  policy?: {
    decision: "allowed" | "denied";
    applied: CapsulePolicy;
    notes?: string[];
  };
  resource?: CapsuleReceipt["resource"];
  metadata?: CapsuleReceiptMetadata;
}

export interface ReceiptSigner {
  algorithm: string;
  keyId?: string;
  sign(receipt: Omit<CapsuleReceipt, "signature">): string;
}

function sanitizeProviderOptionValue(key: string, value: ProviderOptionValue, policy: CapsulePolicy): ProviderOptionValue {
  if (isSensitiveKey(key, policy)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderOptionValue(key, item, policy));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeProviderOptionValue(childKey, childValue, policy)]));
  }
  if (typeof value === "string") {
    return redactSensitiveText(value, undefined, policy);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeMetadataValue(key: string, value: unknown, policy: CapsulePolicy): unknown {
  if (isSensitiveKey(key, policy)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadataValue(key, item, policy));
  }
  if (isPlainObject(value)) {
    return sanitizeReceiptMetadata(value, policy);
  }
  if (typeof value === "string") {
    return redactSensitiveText(value, undefined, policy);
  }
  return value;
}

export function sanitizeProviderOptions(providerOptions: ProviderOptions | undefined, policy: CapsulePolicy = {}): ProviderOptions | undefined {
  if (!providerOptions) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(providerOptions).map(([key, value]) => [key, sanitizeProviderOptionValue(key, value, policy)]));
}

export function sanitizeReceiptMetadata(metadata: Record<string, unknown> | undefined, policy: CapsulePolicy = {}): CapsuleReceiptMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, sanitizeMetadataValue(key, value, policy)]));
}

export function createReceipt(input: CreateReceiptInput, signer?: ReceiptSigner): CapsuleReceipt {
  const finishedAt = input.finishedAt ?? new Date();
  const artifactHashes = input.artifacts?.map((artifact) => artifact.sha256).filter((hash): hash is string => Boolean(hash));
  const receipt: Omit<CapsuleReceipt, "signature"> = {
    id: randomUUID(),
    type: input.type,
    provider: input.provider,
    adapter: input.adapter,
    capabilityPath: input.capabilityPath,
    supportLevel: input.supportLevel,
    command: input.command,
    image: input.image,
    source: input.source,
    cwd: input.cwd,
    providerOptions: sanitizeProviderOptions(input.providerOptions, input.policy?.applied),
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - input.startedAt.getTime(),
    exitCode: input.exitCode,
    stdoutHash: input.stdout === undefined ? undefined : sha256(input.stdout),
    stderrHash: input.stderr === undefined ? undefined : sha256(input.stderr),
    artifactHashes,
    policy: input.policy ?? { decision: "allowed", applied: {} },
    resource: input.resource,
    metadata: sanitizeReceiptMetadata(input.metadata, input.policy?.applied)
  };
  if (!signer) {
    return receipt;
  }
  return {
    ...receipt,
    signature: {
      algorithm: signer.algorithm,
      value: signer.sign(receipt),
      keyId: signer.keyId
    }
  };
}
