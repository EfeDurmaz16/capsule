import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const markerPattern = /\bTODO\b|\bFIXME\b|\bstub\b|mock[- ]level|technical[- ]debt/i;
const shippedRoots = ["packages", "examples", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const allowlistedPathPattern = /(^|\/)(docs|dist|node_modules)(\/|$)|(\.test|\.live\.test)\.[cm]?[jt]s$/;
const errors = [];

function extension(path) {
  const match = path.match(/(\.[^.]+)$/);
  return match?.[1] ?? "";
}

function walk(dir, visitor) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(path, visitor);
      continue;
    }
    visitor(path);
  }
}

for (const shippedRoot of shippedRoots) {
  const absoluteRoot = join(root, shippedRoot);
  if (!existsSync(absoluteRoot)) continue;
  walk(absoluteRoot, (file) => {
    const rel = relative(root, file);
    if (!sourceExtensions.has(extension(file))) return;
    if (allowlistedPathPattern.test(rel)) return;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (markerPattern.test(line)) {
        errors.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  });
}

if (errors.length > 0) {
  console.error("Unfinished marker gate failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Unfinished marker gate passed.");
