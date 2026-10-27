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
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("@capsule-sdk/"));
}

test("engine-aware package pack smoke excludes Node 24-only packages on Node 22", () => {
  const packages = listedPackages("22.0.0");

  assert.ok(packages.includes("@capsule-sdk/core"));
  assert.ok(packages.includes("@capsule-sdk/cli"));
  assert.ok(!packages.includes("@capsule-sdk/store-sqlite"));
});

test("engine-aware package pack smoke includes every public package on Node 24", () => {
  const packages = listedPackages("24.0.0");

  assert.ok(packages.includes("@capsule-sdk/store-sqlite"));
  assert.equal(packages.length, 22);
});

test("CI-06: packed contents allow package metadata and dist output only", async () => {
  const { packedEntryViolations } = await import("./packed-file-policy.mjs");
  const clean = ["package/package.json", "package/LICENSE", "package/dist/index.js", "package/dist/index.d.ts", "package/dist/index.d.ts.map"];
  assert.deepEqual(packedEntryViolations("@capsule-sdk/demo", clean), []);

  const leaked = packedEntryViolations("@capsule-sdk/demo", [
    ...clean,
    "package/dist/capsule.test.js",
    "package/dist/neon.live.test.d.ts",
    "package/dist/__fixtures__/receipt.js",
    "package/src/index.ts",
    "package/.env",
    "package/tsconfig.tsbuildinfo"
  ]);
  assert.equal(leaked.length, 6);
  assert.match(leaked.join("\n"), /test or fixture file dist\/capsule\.test\.js/);
  assert.match(leaked.join("\n"), /unexpected file src\/index\.ts/);
  assert.match(leaked.join("\n"), /\.env, which must never be published/);

  assert.match(packedEntryViolations("@capsule-sdk/demo", ["package/package.json"]).join("\n"), /missing its entrypoint dist\/index\.js/);
});
