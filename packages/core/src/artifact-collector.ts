import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join, posix } from "node:path";
import type { Artifact } from "./types.js";

const defaultMaxFiles = 1000;
const defaultMaxBytes = 64 * 1024 * 1024;
const hashChunkBytes = 64 * 1024;

export interface CollectFileArtifactsOptions {
  // Stop after this many files. Defaults to 1000 so an unexpectedly large tree cannot exhaust memory.
  maxFiles?: number;
  // Stop once collected file content reaches this many total bytes. Defaults to 64 MiB. A single file
  // larger than the remaining budget is skipped whole, never partially hashed. The size is checked on the
  // opened file before any content is read, and reads stop at the remaining budget if the file grows.
  maxBytes?: number;
}

export interface CollectFileArtifactsTruncation {
  reason: "maxFiles" | "maxBytes";
  collectedFiles: number;
  collectedBytes: number;
}

export interface CollectFileArtifactsResult {
  artifacts: Artifact[];
  truncated: boolean;
  truncation?: CollectFileArtifactsTruncation;
}

// Walk a directory tree and produce one Artifact per regular file, with a sha256 over its bytes.
// Symlinks (file or directory) are never followed, so collection cannot escape the tree or loop.
// Entries are visited in sorted order for deterministic output, and bounded by maxFiles/maxBytes with
// explicit truncation info rather than silently dropping files.
export function collectFileArtifacts(dir: string, options: CollectFileArtifactsOptions = {}): CollectFileArtifactsResult {
  const maxFiles = options.maxFiles ?? defaultMaxFiles;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const artifacts: Artifact[] = [];
  const state = { bytes: 0 };
  let truncation: CollectFileArtifactsTruncation | undefined;

  const walk = (current: string, relative: string): boolean => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const childRelative = relative ? `${relative}${posix.sep}${entry.name}` : entry.name;
      const childPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!walk(childPath, childRelative)) {
          return false;
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (artifacts.length >= maxFiles) {
        truncation = { reason: "maxFiles", collectedFiles: artifacts.length, collectedBytes: state.bytes };
        return false;
      }
      const hashed = hashFileWithinBudget(childPath, maxBytes - state.bytes);
      if (!hashed) {
        truncation = { reason: "maxBytes", collectedFiles: artifacts.length, collectedBytes: state.bytes };
        return false;
      }
      state.bytes += hashed.sizeBytes;
      artifacts.push({
        name: childRelative,
        path: childRelative,
        sizeBytes: hashed.sizeBytes,
        sha256: hashed.sha256
      });
    }
    return true;
  };

  walk(dir, "");
  return truncation ? { artifacts, truncated: true, truncation } : { artifacts, truncated: false };
}

// Hash one whole file through a fixed-size buffer. Returns undefined, without reading content, when the
// opened file is already larger than the remaining budget, and stops reading as soon as a file that grew
// after the size check exceeds it. A file is either hashed whole or not collected at all.
function hashFileWithinBudget(path: string, remainingBytes: number): { sizeBytes: number; sha256: string } | undefined {
  const fd = openSync(path, "r");
  try {
    if (fstatSync(fd).size > remainingBytes) {
      return undefined;
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(hashChunkBytes, remainingBytes + 1)));
    let sizeBytes = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.byteLength, remainingBytes - sizeBytes + 1), null);
      if (read === 0) {
        return { sizeBytes, sha256: hash.digest("hex") };
      }
      sizeBytes += read;
      if (sizeBytes > remainingBytes) {
        return undefined;
      }
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
}
