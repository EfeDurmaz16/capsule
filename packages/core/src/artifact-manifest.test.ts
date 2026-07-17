import { describe, expect, test } from "vitest";
import { sha256 } from "./artifacts.js";
import { createArtifactManifest, verifyArtifactManifest, type ArtifactManifest } from "./artifact-manifest.js";
import type { Artifact } from "./types.js";

describe("createArtifactManifest", () => {
  const artifacts: Artifact[] = [
    { name: "stdout.txt", path: "logs/stdout.txt", contentType: "text/plain", sizeBytes: 12, sha256: sha256("stdout bytes") },
    { name: "report.json", path: "report.json", sizeBytes: 3, sha256: sha256("{}\n") }
  ];

  test("produces a versioned, verifiable manifest over the given artifacts", () => {
    const manifest = createArtifactManifest(artifacts, { createdAt: "2026-01-01T00:00:00.000Z" });
    expect(manifest.schema).toBe("capsule.artifact.manifest.v1");
    expect(manifest.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.digest.algorithm).toBe("sha256");
    expect(verifyArtifactManifest(manifest)).toEqual({ valid: true });
  });

  test("digest is stable regardless of artifact object key insertion order", () => {
    const forward = createArtifactManifest([{ name: "a", path: "a", sizeBytes: 1, sha256: "aa" }], { createdAt: "2026-01-01T00:00:00.000Z" });
    const reordered = createArtifactManifest([{ sha256: "aa", sizeBytes: 1, path: "a", name: "a" } as Artifact], { createdAt: "2026-01-01T00:00:00.000Z" });
    expect(reordered.digest.value).toBe(forward.digest.value);
  });

  test("digest changes when the artifact set changes", () => {
    const base = createArtifactManifest(artifacts, { createdAt: "2026-01-01T00:00:00.000Z" });
    const extra = createArtifactManifest([...artifacts, { name: "extra.txt", sha256: sha256("x") }], { createdAt: "2026-01-01T00:00:00.000Z" });
    expect(extra.digest.value).not.toBe(base.digest.value);
  });

  test("handles an empty manifest and verifies it", () => {
    const manifest = createArtifactManifest([], { createdAt: "2026-01-01T00:00:00.000Z" });
    expect(manifest.entries).toEqual([]);
    expect(verifyArtifactManifest(manifest)).toEqual({ valid: true });
    const other = createArtifactManifest([], { createdAt: "2026-01-01T00:00:00.000Z" });
    expect(other.digest.value).toBe(manifest.digest.value);
  });

  test("accepts a Date for createdAt", () => {
    const manifest = createArtifactManifest(artifacts, { createdAt: new Date("2026-02-02T02:02:02.000Z") });
    expect(manifest.createdAt).toBe("2026-02-02T02:02:02.000Z");
  });
});

describe("verifyArtifactManifest", () => {
  const manifest = createArtifactManifest([{ name: "a.txt", path: "a.txt", sizeBytes: 3, sha256: sha256("abc") }], {
    createdAt: "2026-01-01T00:00:00.000Z"
  });

  test("detects a tampered entry", () => {
    const tampered: ArtifactManifest = { ...manifest, entries: [{ ...manifest.entries[0]!, sha256: sha256("evil") }] };
    const result = verifyArtifactManifest(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("digest-mismatch");
    expect(result.expectedDigest).toBe(manifest.digest.value);
    expect(result.actualDigest).not.toBe(manifest.digest.value);
  });

  test("detects a tampered createdAt", () => {
    const tampered: ArtifactManifest = { ...manifest, createdAt: "2020-01-01T00:00:00.000Z" };
    expect(verifyArtifactManifest(tampered).reason).toBe("digest-mismatch");
  });

  test("rejects a non-sha256 digest algorithm", () => {
    const badAlgorithm = { ...manifest, digest: { ...manifest.digest, algorithm: "sha1" } } as unknown as ArtifactManifest;
    expect(verifyArtifactManifest(badAlgorithm)).toEqual({ valid: false, reason: "digest-algorithm-mismatch" });
  });
});
