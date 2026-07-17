import { createHash } from "node:crypto";
import type { Artifact } from "./types.js";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface ArtifactHashVerificationResult {
  valid: boolean;
  reason?: "missing-hash" | "hash-mismatch";
  expected?: string;
  actual?: string;
}

// Recompute sha256(content) and compare it against the hash an Artifact claims. A missing claimed
// hash is treated as unverifiable rather than valid, so callers cannot mistake "no hash" for "trusted".
export function verifyArtifactHash(artifact: Pick<Artifact, "sha256">, content: string | Uint8Array): ArtifactHashVerificationResult {
  const actual = sha256(content);
  if (artifact.sha256 === undefined) {
    return { valid: false, reason: "missing-hash", actual };
  }
  if (artifact.sha256 !== actual) {
    return { valid: false, reason: "hash-mismatch", expected: artifact.sha256, actual };
  }
  return { valid: true, expected: artifact.sha256, actual };
}
