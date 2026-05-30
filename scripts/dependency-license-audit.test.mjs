import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "dependency-license-audit.mjs");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFakePnpm(binDir, licenseGroups) {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "pnpm"),
    [
      "#!/usr/bin/env sh",
      "if [ \"$1 $2 $3 $4\" = \"licenses list --prod --json\" ]; then",
      `  cat <<'JSON'\n${JSON.stringify(licenseGroups, null, 2)}\nJSON`,
      "  exit 0",
      "fi",
      "printf 'unexpected pnpm command: %s\\n' \"$*\" >&2",
      "exit 42",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
}

function runWithFakePnpm(args, licenseGroups) {
  const tempRoot = mkdtempSync(join(tmpdir(), "capsule-dependency-audit-test-"));

  try {
    const binDir = join(tempRoot, "bin");
    writeFakePnpm(binDir, licenseGroups);
    return {
      result: spawnSync(process.execPath, [scriptPath, ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`
        }
      }),
      tempRoot
    };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

test("passes for current runtime dependency allowlist and permissive licenses", () => {
  const { result, tempRoot } = runWithFakePnpm(["--root", root], {
    MIT: [{ name: "allowed", versions: ["1.0.0"] }],
    "(Apache-2.0 AND BSD-3-Clause)": [{ name: "dual", versions: ["1.0.0"] }]
  });

  try {
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Dependency and license audit passed/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects copyleft or unknown production dependency licenses", () => {
  const { result, tempRoot } = runWithFakePnpm(["--root", root], {
    "GPL-3.0-only": [{ name: "copyleft", versions: ["1.0.0"] }],
    UNKNOWN: [{ name: "mystery", versions: ["2.0.0"] }]
  });

  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Dependency and license audit failed:/);
    assert.match(result.stderr, /license GPL-3\.0-only is not allowlisted/);
    assert.match(result.stderr, /license UNKNOWN is not allowlisted/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("rejects unexpected public package runtime dependencies", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-dependency-audit-fixture-"));
  const binDir = join(fixtureRoot, "bin");
  const packageDir = join(fixtureRoot, "packages", "fixture");

  try {
    mkdirSync(packageDir, { recursive: true });
    writeJson(join(packageDir, "package.json"), {
      name: "@capsule/fixture",
      version: "1.0.0",
      dependencies: {
        "left-pad": "1.3.0"
      }
    });
    writeFakePnpm(binDir, {
      MIT: [{ name: "left-pad", versions: ["1.3.0"] }]
    });

    const result = spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /@capsule\/fixture: unexpected runtime dependency left-pad/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
