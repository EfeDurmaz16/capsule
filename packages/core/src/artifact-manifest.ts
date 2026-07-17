import { sha256 } from "./artifacts.js";
import { canonicalJson } from "./canonical.js";
import type { Artifact } from "./types.js";

const artifactManifestSchema = "capsule.artifact.manifest.v1" as const;

export interface ArtifactManifestEntry {
  name: string;
  path?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface ArtifactManifest {
  schema: typeof artifactManifestSchema;
  createdAt: string;
  entries: ArtifactManifestEntry[];
  digest: {
    algorithm: "sha256";
    value: string;
  };
}

export interface CreateArtifactManifestOptions {
  createdAt?: Date | string;
}

export interface ArtifactManifestVerificationResult {
  valid: boolean;
  reason?: "digest-algorithm-mismatch" | "digest-mismatch";
  expectedDigest?: string;
  actualDigest?: string;
}

// Build a content-addressed manifest over a set of artifacts, mirroring the evidence bundle: the
// digest is a sha256 over the canonical (key-sorted, undefined-dropped) payload so it is stable
// under key order and changes if any entry is added, removed, or tampered with.
export function createArtifactManifest(artifacts: readonly Artifact[], options: CreateArtifactManifestOptions = {}): ArtifactManifest {
  const payload: Omit<ArtifactManifest, "digest"> = {
    schema: artifactManifestSchema,
    createdAt: normalizeManifestTimestamp(options.createdAt),
    entries: artifacts.map((artifact) => ({
      name: artifact.name,
      path: artifact.path,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256
    }))
  };
  return {
    ...payload,
    digest: {
      algorithm: "sha256",
      value: sha256(canonicalManifestPayload(payload))
    }
  };
}

export function verifyArtifactManifest(manifest: ArtifactManifest): ArtifactManifestVerificationResult {
  if (manifest.digest.algorithm !== "sha256") {
    return { valid: false, reason: "digest-algorithm-mismatch" };
  }
  const actualDigest = sha256(canonicalManifestPayload(manifest));
  if (actualDigest !== manifest.digest.value) {
    return {
      valid: false,
      reason: "digest-mismatch",
      expectedDigest: manifest.digest.value,
      actualDigest
    };
  }
  return { valid: true };
}

function canonicalManifestPayload(manifest: ArtifactManifest | Omit<ArtifactManifest, "digest">): string {
  const { digest: _digest, ...payload } = manifest as ArtifactManifest;
  return canonicalJson(payload);
}

function normalizeManifestTimestamp(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}
