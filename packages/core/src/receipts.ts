import { randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import { isSensitiveKey, redactSensitiveText } from "./policy.js";
import type { Artifact, CapsulePolicy, CapsuleReceipt, CapsuleReceiptMetadata, ProviderOptions, ProviderOptionValue, SupportLevel } from "./types.js";

export type UnsignedReceipt = Omit<CapsuleReceipt, "signature">;

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

export interface ProviderRuntimeMetadataInput {
  providerApiVersion?: string | null;
  providerRegion?: string | null;
  runtimeVersion?: string | null;
  adapterVersion?: string | null;
}

export interface ReceiptSigner {
  algorithm: string;
  keyId?: string;
  sign(receipt: UnsignedReceipt, canonicalPayload: string): string;
}

export interface ReceiptVerifier {
  algorithm: string;
  keyId?: string;
  verify(canonicalPayload: string, signature: string, receipt: UnsignedReceipt): boolean;
}

export type ReceiptSignatureVerificationResult =
  | { valid: true }
  | { valid: false; reason: "missing-signature" | "algorithm-mismatch" | "key-id-mismatch" | "signature-mismatch" };

export function unsignedReceipt(receipt: CapsuleReceipt): UnsignedReceipt {
  const { signature: _signature, ...unsigned } = receipt;
  return unsigned;
}

export function canonicalReceiptPayload(receipt: CapsuleReceipt | UnsignedReceipt): string {
  return canonicalJson("signature" in receipt ? unsignedReceipt(receipt) : receipt);
}

export function verifyReceiptSignature(receipt: CapsuleReceipt, verifier: ReceiptVerifier): ReceiptSignatureVerificationResult {
  if (!receipt.signature) {
    return { valid: false, reason: "missing-signature" };
  }
  if (receipt.signature.algorithm !== verifier.algorithm) {
    return { valid: false, reason: "algorithm-mismatch" };
  }
  if (verifier.keyId !== undefined && receipt.signature.keyId !== verifier.keyId) {
    return { valid: false, reason: "key-id-mismatch" };
  }
  const unsigned = unsignedReceipt(receipt);
  const payload = canonicalReceiptPayload(unsigned);
  if (!verifier.verify(payload, receipt.signature.value, unsigned)) {
    return { valid: false, reason: "signature-mismatch" };
  }
  return { valid: true };
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

function nonEmptyString(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function providerRuntimeMetadata(input: ProviderRuntimeMetadataInput = {}): CapsuleReceiptMetadata {
  return Object.fromEntries(
    Object.entries({
      providerApiVersion: nonEmptyString(input.providerApiVersion),
      providerRegion: nonEmptyString(input.providerRegion),
      runtimeVersion: nonEmptyString(input.runtimeVersion) ?? process.version,
      adapterVersion: nonEmptyString(input.adapterVersion)
    }).filter(([, value]) => value !== undefined)
  );
}

export function createReceipt(input: CreateReceiptInput, signer?: ReceiptSigner): CapsuleReceipt {
  const finishedAt = input.finishedAt ?? new Date();
  const artifactHashes = input.artifacts?.map((artifact) => artifact.sha256).filter((hash): hash is string => Boolean(hash));
  const receipt: UnsignedReceipt = {
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
      value: signer.sign(receipt, canonicalReceiptPayload(receipt)),
      keyId: signer.keyId
    }
  };
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
