import { randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import type { Artifact, CapsulePolicy, CapsuleReceipt, SupportLevel } from "./types.js";

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

export function createReceipt(input: CreateReceiptInput): CapsuleReceipt {
  const finishedAt = input.finishedAt ?? new Date();
  const artifactHashes = input.artifacts?.map((artifact) => artifact.sha256).filter((hash): hash is string => Boolean(hash));
  return {
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
}
