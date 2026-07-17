import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { sha256 } from "./artifacts.js";
import type { Artifact } from "./types.js";

const defaultMaxFiles = 1000;
const defaultMaxBytes = 64 * 1024 * 1024;

export interface CollectFileArtifactsOptions {
  // Stop after this many files. Defaults to 1000 so an unexpectedly large tree cannot exhaust memory.
  maxFiles?: number;
  // Stop once collected file content reaches this many total bytes. Defaults to 64 MiB. A single file
  // larger than the remaining budget is skipped whole, never partially hashed.
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
      const content = readFileSync(childPath);
      if (state.bytes + content.byteLength > maxBytes) {
        truncation = { reason: "maxBytes", collectedFiles: artifacts.length, collectedBytes: state.bytes };
        return false;
      }
      state.bytes += content.byteLength;
      artifacts.push({
        name: childRelative,
        path: childRelative,
        sizeBytes: content.byteLength,
        sha256: sha256(content)
      });
    }
    return true;
  };

  walk(dir, "");
  return truncation ? { artifacts, truncated: true, truncation } : { artifacts, truncated: false };
}
