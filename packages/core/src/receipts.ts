import { randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import type { Artifact, CapsulePolicy, CapsuleReceipt, ProviderOptions, ProviderOptionValue, SupportLevel } from "./types.js";

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
  metadata?: Record<string, unknown>;
}

export interface ReceiptSigner {
  algorithm: string;
  keyId?: string;
  sign(receipt: Omit<CapsuleReceipt, "signature">): string;
}

const secretOptionKey = /(api[-_]?key|auth|credential|password|private[-_]?key|secret|token)/i;

function sanitizeProviderOptionValue(key: string, value: ProviderOptionValue): ProviderOptionValue {
  if (secretOptionKey.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderOptionValue(key, item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeProviderOptionValue(childKey, childValue)]));
  }
  return value;
}

export function sanitizeProviderOptions(providerOptions: ProviderOptions | undefined): ProviderOptions | undefined {
  if (!providerOptions) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(providerOptions).map(([key, value]) => [key, sanitizeProviderOptionValue(key, value)]));
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
    providerOptions: sanitizeProviderOptions(input.providerOptions),
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - input.startedAt.getTime(),
    exitCode: input.exitCode,
    stdoutHash: input.stdout === undefined ? undefined : sha256(input.stdout),
    stderrHash: input.stderr === undefined ? undefined : sha256(input.stderr),
    artifactHashes,
    policy: input.policy ?? { decision: "allowed", applied: {} },
    resource: input.resource,
    metadata: input.metadata
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
