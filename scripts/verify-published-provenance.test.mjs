import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "verify-published-provenance.mjs");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("dry-run lists public packages without shelling out to npm", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-provenance-test-"));

  try {
    const publicPackageDir = join(fixtureRoot, "packages", "public-package");
    const privatePackageDir = join(fixtureRoot, "packages", "private-package");
    const fakeBinDir = join(fixtureRoot, "bin");

    mkdirSync(publicPackageDir, { recursive: true });
    mkdirSync(privatePackageDir, { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });

    writeJson(join(publicPackageDir, "package.json"), {
      name: "@capsule/public-package",
      version: "1.2.3"
    });
    writeJson(join(privatePackageDir, "package.json"), {
      name: "@capsule/private-package",
      version: "1.2.3",
      private: true
    });
    writeFileSync(
      join(fakeBinDir, "npm"),
      "#!/usr/bin/env sh\nprintf 'npm must not be called during dry-run\\n' >&2\nexit 42\n",
      { mode: 0o755 }
    );

    const stdout = execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--dry-run"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`
      }
    });

    assert.match(stdout, /Provenance verification dry-run/);
    assert.match(stdout, /@capsule\/public-package@1\.2\.3/);
    assert.doesNotMatch(stdout, /@capsule\/private-package/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("real mode checks published dist provenance metadata with npm view", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-provenance-test-"));

  try {
    const publicPackageDir = join(fixtureRoot, "packages", "public-package");
    const fakeBinDir = join(fixtureRoot, "bin");
    const npmArgsLog = join(fixtureRoot, "npm-args.log");

    mkdirSync(publicPackageDir, { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });

    writeJson(join(publicPackageDir, "package.json"), {
      name: "@capsule/public-package",
      version: "1.2.3"
    });
    writeFileSync(
      join(fakeBinDir, "npm"),
      [
        "#!/usr/bin/env sh",
        "printf '%s\\n' \"$*\" >> \"$NPM_ARGS_LOG\"",
        "if [ \"$1\" = \"view\" ]; then",
        "  printf '%s\\n' '{\"integrity\":\"sha512-test\",\"signatures\":[{\"keyid\":\"SHA256:test\",\"sig\":\"test\"}],\"attestations\":{\"url\":\"https://registry.npmjs.org/-/npm/v1/attestations/@capsule%2fpublic-package@1.2.3\",\"provenance\":{\"predicateType\":\"https://slsa.dev/provenance/v1\"}}}'",
        "  exit 0",
        "fi",
        "printf 'unexpected npm command\\n' >&2",
        "exit 42",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );

    const stdout = execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--no-dry-run"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NPM_ARGS_LOG: npmArgsLog,
        PATH: `${fakeBinDir}:${process.env.PATH}`
      }
    });

    assert.match(stdout, /Published provenance verification passed/);
    assert.match(stdout, /@capsule\/public-package@1\.2\.3: provenance metadata present/);
    assert.match(execFileSync("cat", [npmArgsLog], { encoding: "utf8" }), /view @capsule\/public-package@1\.2\.3 dist --json/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
