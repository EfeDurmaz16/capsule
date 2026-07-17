import { describe, expect, test } from "vitest";
import { sha256, verifyArtifactHash } from "./artifacts.js";

describe("verifyArtifactHash", () => {
  test("accepts content whose hash matches the claimed sha256", () => {
    const content = "hello artifact";
    const result = verifyArtifactHash({ sha256: sha256(content) }, content);
    expect(result).toEqual({ valid: true, expected: sha256(content), actual: sha256(content) });
  });

  test("rejects tampered content with a hash mismatch and both hashes", () => {
    const artifact = { sha256: sha256("original") };
    const result = verifyArtifactHash(artifact, "tampered");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("hash-mismatch");
    expect(result.expected).toBe(sha256("original"));
    expect(result.actual).toBe(sha256("tampered"));
  });

  test("treats a missing claimed hash as unverifiable rather than valid", () => {
    const result = verifyArtifactHash({}, "content");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing-hash");
    expect(result.actual).toBe(sha256("content"));
    expect(result.expected).toBeUndefined();
  });

  test("hashes binary content", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
    const result = verifyArtifactHash({ sha256: sha256(bytes) }, bytes);
    expect(result.valid).toBe(true);
  });
});
