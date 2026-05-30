import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "package-pack-smoke.mjs");

function listedPackages(nodeVersion) {
  const stdout = execFileSync(process.execPath, [scriptPath, "--root", root, "--respect-engines", "--node-version", nodeVersion, "--list-packages"], {
    encoding: "utf8"
  });
  return stdout.trim().split(/\r?\n/).filter((line) => line.startsWith("@capsule/"));
}

test("engine-aware package pack smoke excludes Node 24-only packages on Node 20", () => {
  const packages = listedPackages("20.11.0");

  assert.ok(packages.includes("@capsule/core"));
  assert.ok(packages.includes("@capsule/cli"));
  assert.ok(!packages.includes("@capsule/store-sqlite"));
});

test("engine-aware package pack smoke includes every public package on Node 24", () => {
  const packages = listedPackages("24.0.0");

  assert.ok(packages.includes("@capsule/store-sqlite"));
  assert.equal(packages.length, 22);
});
