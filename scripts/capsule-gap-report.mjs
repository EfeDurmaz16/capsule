#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packagesDir = join(root, "packages");
const examplesDir = join(root, "examples");

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") continue;
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function packageName(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name ?? dir;
  } catch {
    return dir;
  }
}

const supportPattern = /([A-Za-z0-9_]+):\s*"(native|emulated|experimental|unsupported)"/g;
const adapterReports = [];

for (const entry of readdirSync(packagesDir)) {
  if (!entry.startsWith("adapter-")) continue;
  const dir = join(packagesDir, entry);
  const files = walk(join(dir, "src")).filter((file) => file.endsWith(".ts"));
  const levels = { native: 0, emulated: 0, experimental: 0, unsupported: 0 };

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(supportPattern)) {
      levels[match[2]] += 1;
    }
  }

  adapterReports.push({ name: packageName(dir), levels });
}

const mockExamples = walk(examplesDir)
  .filter((file) => file.endsWith(".ts") || file.endsWith("package.json"))
  .filter((file) => readFileSync(file, "utf8").includes("@capsule/adapter-mock"))
  .map((file) => relative(root, file));

adapterReports.sort((a, b) => a.name.localeCompare(b.name));

console.log("# Capsule Gap Report\n");
console.log("| Adapter | Native | Emulated | Experimental | Unsupported |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const report of adapterReports) {
  const { levels } = report;
  console.log(`| ${report.name} | ${levels.native} | ${levels.emulated} | ${levels.experimental} | ${levels.unsupported} |`);
}

console.log("\n## Mock-First Example References\n");
if (mockExamples.length === 0) {
  console.log("No examples import @capsule/adapter-mock.");
} else {
  for (const file of mockExamples) console.log(`- ${file}`);
}

console.log("\n## Recommended Next Work\n");
console.log("- Reduce unsupported counts by implementing explicit lifecycle operations, not by pretending support exists.");
console.log("- Move examples to env-gated real adapters while preserving mock mode for credential-free docs.");
console.log("- Add live tests behind CAPSULE_LIVE_TESTS=1 and provider-specific credentials.");
