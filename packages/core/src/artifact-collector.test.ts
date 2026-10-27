import fs, { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { collectFileArtifacts } from "./artifact-collector.js";
import { sha256 } from "./artifacts.js";

describe("collectFileArtifacts", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "capsule-collector-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("PERF-02: hashes each small file with one read through one buffer shared by the walk", () => {
    // Before, every file got its own 64 KiB buffer and a second read to see end of file, which made many
    // small files slower than readFileSync at 7d3a28a. Hashes and sizes are unchanged.
    const contents = Array.from({ length: 25 }, (_, index) => `file ${index} `.repeat(index + 1));
    contents.forEach((content, index) => writeFileSync(join(dir, `f${String(index).padStart(2, "0")}.txt`), content));
    writeFileSync(join(dir, "empty.txt"), "");
    const originalReadSync = fs.readSync;
    const buffers: unknown[] = [];
    fs.readSync = function (this: unknown, ...args: Parameters<typeof fs.readSync>) {
      buffers.push(args[1]);
      return originalReadSync.apply(this, args);
    } as typeof fs.readSync;
    syncBuiltinESMExports();
    let artifacts;
    try {
      ({ artifacts } = collectFileArtifacts(dir));
    } finally {
      fs.readSync = originalReadSync;
      syncBuiltinESMExports();
    }
    expect(buffers).toHaveLength(26);
    expect(new Set(buffers).size).toBe(1);
    expect(artifacts.map((artifact) => [artifact.path, artifact.sizeBytes, artifact.sha256])).toEqual([
      ["empty.txt", 0, sha256("")],
      ...contents.map((content, index) => [`f${String(index).padStart(2, "0")}.txt`, Buffer.byteLength(content), sha256(content)])
    ]);
  });

  test("walks nested files, hashes each, and uses posix relative paths", () => {
    writeFileSync(join(dir, "root.txt"), "root");
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "child.txt"), "child");

    const { artifacts, truncated } = collectFileArtifacts(dir);

    expect(truncated).toBe(false);
    expect(artifacts).toEqual([
      { name: "nested/child.txt", path: "nested/child.txt", sizeBytes: 5, sha256: sha256("child") },
      { name: "root.txt", path: "root.txt", sizeBytes: 4, sha256: sha256("root") }
    ]);
  });

  test("returns deterministic sorted order", () => {
    writeFileSync(join(dir, "b.txt"), "b");
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "c.txt"), "c");
    const names = collectFileArtifacts(dir).artifacts.map((artifact) => artifact.name);
    expect(names).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  test("does not follow symlinks (file or directory)", () => {
    writeFileSync(join(dir, "real.txt"), "real");
    const outside = mkdtempSync(join(tmpdir(), "capsule-collector-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret");
      symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));
      symlinkSync(outside, join(dir, "linkdir"));

      const names = collectFileArtifacts(dir).artifacts.map((artifact) => artifact.name);
      expect(names).toEqual(["real.txt"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("truncates on maxFiles with explicit info", () => {
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(dir, `file-${index}.txt`), String(index));
    }
    const result = collectFileArtifacts(dir, { maxFiles: 2 });
    expect(result.artifacts).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.truncation).toEqual({ reason: "maxFiles", collectedFiles: 2, collectedBytes: 2 });
  });

  test("truncates on maxBytes and never partially hashes an oversized file", () => {
    writeFileSync(join(dir, "a.txt"), "aaaa"); // 4 bytes
    writeFileSync(join(dir, "b.txt"), "bbbbbb"); // 6 bytes, would exceed budget of 5
    const result = collectFileArtifacts(dir, { maxBytes: 5 });
    expect(result.artifacts.map((artifact) => artifact.name)).toEqual(["a.txt"]);
    expect(result.truncated).toBe(true);
    expect(result.truncation).toEqual({ reason: "maxBytes", collectedFiles: 1, collectedBytes: 4 });
  });

  test("returns an empty result for an empty directory", () => {
    expect(collectFileArtifacts(dir)).toEqual({ artifacts: [], truncated: false });
  });
});
