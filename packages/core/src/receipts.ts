import { randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import { credentialTokenPatternSource, isSensitiveKey, redactSensitiveText } from "./policy.js";
import { capsuleReceiptJsonSchema } from "./receipt-schema.js";
import type {
  Artifact,
  CapsulePolicy,
  CapsuleReceipt,
  CapsuleReceiptMetadata,
  CapsuleReceiptPolicy,
  ProviderOptions,
  ProviderOptionValue,
  SupportLevel
} from "./types.js";

export const CAPSULE_RECEIPT_SCHEMA_VERSION = "capsule.receipt.v1";

export type UnsignedReceipt = Omit<CapsuleReceipt, "signature">;

export interface CreateReceiptInput {
  type: CapsuleReceipt["type"];
  parentId?: string;
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
  policy?: CapsuleReceiptPolicy;
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
  { valid: true } | { valid: false; reason: "missing-signature" | "algorithm-mismatch" | "key-id-mismatch" | "signature-mismatch" };

export interface ReceiptVerificationReport {
  valid: boolean;
  schema: {
    valid: boolean;
    errors: string[];
  };
  signature: {
    status: "missing" | "present-unverified" | "valid" | "invalid";
    reason?: "missing-signature" | "algorithm-mismatch" | "key-id-mismatch" | "signature-mismatch";
  };
  redaction: {
    status: "passed" | "failed";
    findings: string[];
  };
}

export interface VerifyReceiptOptions {
  verifier?: ReceiptVerifier;
  requireSignature?: boolean;
  redactionPolicy?: CapsulePolicy;
}

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

const receiptTypes = new Set<string>(capsuleReceiptJsonSchema.properties.type.enum);
const supportLevels = new Set<string>(["native", "emulated", "unsupported", "experimental"]);
const credentialLikeValue = new RegExp(credentialTokenPatternSource, "i");

export function verifyReceipt(receipt: unknown, options: VerifyReceiptOptions = {}): ReceiptVerificationReport {
  const schemaErrors = receiptSchemaErrors(receipt);
  const schema = { valid: schemaErrors.length === 0, errors: schemaErrors };
  const signature = receiptSignatureStatus(receipt, options);
  const findings = receiptRedactionFindings(receipt, options.redactionPolicy);
  const redaction = { status: findings.length === 0 ? "passed" : "failed", findings } as ReceiptVerificationReport["redaction"];

  return {
    valid: schema.valid && signature.status !== "invalid" && redaction.status === "passed",
    schema,
    signature,
    redaction
  };
}

function receiptSchemaErrors(receipt: unknown): string[] {
  if (!isPlainObject(receipt)) {
    return ["receipt must be an object."];
  }
  const errors: string[] = [];
  const required = ["id", "type", "provider", "adapter", "capabilityPath", "supportLevel", "startedAt", "finishedAt", "durationMs", "policy"];
  for (const key of required) {
    if (!(key in receipt)) {
      errors.push(`${key} is required.`);
    }
  }
  for (const key of ["id", "provider", "adapter", "capabilityPath", "startedAt", "finishedAt"]) {
    if (key in receipt && typeof receipt[key] !== "string") {
      errors.push(`${key} must be a string.`);
    }
  }
  if ("type" in receipt && (typeof receipt.type !== "string" || !receiptTypes.has(receipt.type))) {
    errors.push("type must be a known Capsule receipt type.");
  }
  if ("supportLevel" in receipt && (typeof receipt.supportLevel !== "string" || !supportLevels.has(receipt.supportLevel))) {
    errors.push("supportLevel must be one of native, emulated, unsupported, experimental.");
  }
  if ("durationMs" in receipt && typeof receipt.durationMs !== "number") {
    errors.push("durationMs must be a number.");
  }
  if ("policy" in receipt) {
    if (!isPlainObject(receipt.policy)) {
      errors.push("policy must be an object.");
    } else {
      if (receipt.policy.decision !== "allowed" && receipt.policy.decision !== "denied") {
        errors.push("policy.decision must be allowed or denied.");
      }
      if (!isPlainObject(receipt.policy.applied)) {
        errors.push("policy.applied must be an object.");
      }
    }
  }
  if ("signature" in receipt && receipt.signature !== undefined) {
    if (!isPlainObject(receipt.signature)) {
      errors.push("signature must be an object.");
    } else {
      if (typeof receipt.signature.algorithm !== "string") {
        errors.push("signature.algorithm must be a string.");
      }
      if (typeof receipt.signature.value !== "string") {
        errors.push("signature.value must be a string.");
      }
      if ("keyId" in receipt.signature && typeof receipt.signature.keyId !== "string") {
        errors.push("signature.keyId must be a string.");
      }
    }
  }
  return errors;
}

function receiptSignatureStatus(receipt: unknown, options: VerifyReceiptOptions): ReceiptVerificationReport["signature"] {
  if (!isPlainObject(receipt) || !("signature" in receipt) || receipt.signature === undefined) {
    return options.requireSignature ? { status: "invalid", reason: "missing-signature" } : { status: "missing" };
  }
  if (!options.verifier) {
    return { status: "present-unverified" };
  }
  const result = verifyReceiptSignature(receipt as unknown as CapsuleReceipt, options.verifier);
  return result.valid ? { status: "valid" } : { status: "invalid", reason: result.reason };
}

function receiptRedactionFindings(value: unknown, policy: CapsulePolicy | undefined, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => receiptRedactionFindings(item, policy, [...path, String(index)]));
  }
  if (!isPlainObject(value)) {
    if (typeof value === "string" && value !== "[REDACTED]" && credentialLikeValue.test(value) && path.join(".") !== "signature.value") {
      return [`${path.join(".") || "receipt"} contains credential-shaped text.`];
    }
    return [];
  }

  const findings: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (typeof child === "string" && child !== "[REDACTED]" && isSensitiveKey(key, policy)) {
      findings.push(`${childPath.join(".")} contains an unredacted sensitive value.`);
      continue;
    }
    findings.push(...receiptRedactionFindings(child, policy, childPath));
  }
  return findings;
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
    schemaVersion: CAPSULE_RECEIPT_SCHEMA_VERSION,
    parentId: input.parentId,
    type: input.type,
    provider: input.provider,
    adapter: input.adapter,
    capabilityPath: input.capabilityPath,
    supportLevel: input.supportLevel,
    command: input.command?.map((part) => redactSensitiveText(part, undefined, input.policy?.applied ?? {})),
    image: input.image,
    source: input.source === undefined ? undefined : sanitizeReceiptMetadata(input.source, input.policy?.applied),
    cwd: input.cwd === undefined ? undefined : redactSensitiveText(input.cwd, undefined, input.policy?.applied ?? {}),
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
