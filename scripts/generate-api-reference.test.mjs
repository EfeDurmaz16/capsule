import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "generate-api-reference.mjs");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("resolves barrel exports into public symbol names", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-api-reference-test-"));

  try {
    const packageDir = join(fixtureRoot, "packages", "core");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    mkdirSync(join(fixtureRoot, "docs"), { recursive: true });

    writeJson(join(packageDir, "package.json"), {
      name: "@capsule-sdk/core",
      version: "1.2.3",
      exports: {
        ".": {
          import: "./dist/index.js",
          types: "./dist/index.d.ts"
        }
      }
    });
    writeFileSync(
      join(packageDir, "src", "index.ts"),
      ['export * from "./policy.js";', 'export { renamedValue as publicValue, type InternalOptions as PublicOptions } from "./runtime.js";', ""].join("\n")
    );
    writeFileSync(
      join(packageDir, "src", "policy.ts"),
      ["export interface CapsulePolicy {", "  readonly allow: boolean;", "}", "export const agentSafePolicy = { allow: true };", ""].join("\n")
    );
    writeFileSync(
      join(packageDir, "src", "runtime.ts"),
      ["export interface InternalOptions {", "  readonly name: string;", "}", "export const renamedValue = 1;", ""].join("\n")
    );

    execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot], {
      encoding: "utf8"
    });

    const generated = readFileSync(join(fixtureRoot, "docs", "api-reference.md"), "utf8");
    assert.match(generated, /- `agentSafePolicy` \(const\)/);
    assert.match(generated, /- `CapsulePolicy` \(interface\)/);
    assert.match(generated, /- `publicValue` \(const\)/);
    assert.match(generated, /- `PublicOptions` \(interface\)/);
    assert.doesNotMatch(generated, /barrel:/);
    assert.doesNotMatch(generated, /renamedValue/);
    assert.doesNotMatch(generated, /InternalOptions/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("CI-02: --check fails on a stale committed reference and never rewrites it", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-api-reference-check-"));

  try {
    const packageDir = join(fixtureRoot, "packages", "core");
    mkdirSync(join(packageDir, "src"), { recursive: true });
    mkdirSync(join(fixtureRoot, "docs"), { recursive: true });
    writeJson(join(packageDir, "package.json"), { name: "@capsule-sdk/core", version: "1.0.0" });
    writeFileSync(join(packageDir, "src", "index.ts"), "export const firstExport = 1;\n");

    execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot], { encoding: "utf8" });
    const referencePath = join(fixtureRoot, "docs", "api-reference.md");
    const current = execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--check"], { encoding: "utf8" });
    assert.match(current, /is current/);

    writeFileSync(join(packageDir, "src", "index.ts"), "export const firstExport = 1;\nexport const addedExport = 2;\n");
    const before = readFileSync(referencePath, "utf8");
    const stale = spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--check"], { encoding: "utf8" });

    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /docs\/api-reference\.md is stale/);
    assert.equal(readFileSync(referencePath, "utf8"), before);
    assert.doesNotMatch(before, /addedExport/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
