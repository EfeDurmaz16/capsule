import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPublishedDist } from "./verify-published-provenance.mjs";

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
      name: "@capsule-sdk/public-package",
      version: "1.2.3"
    });
    writeJson(join(privatePackageDir, "package.json"), {
      name: "@capsule-sdk/private-package",
      version: "1.2.3",
      private: true
    });
    writeFileSync(join(fakeBinDir, "npm"), "#!/usr/bin/env sh\nprintf 'npm must not be called during dry-run\\n' >&2\nexit 42\n", { mode: 0o755 });

    const stdout = execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--dry-run"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`
      }
    });

    assert.match(stdout, /Provenance attestation metadata check dry-run/);
    assert.match(stdout, /@capsule-sdk\/public-package@1\.2\.3/);
    assert.doesNotMatch(stdout, /@capsule-sdk\/private-package/);
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
      name: "@capsule-sdk/public-package",
      version: "1.2.3"
    });
    writeFileSync(
      join(fakeBinDir, "npm"),
      [
        "#!/usr/bin/env sh",
        'printf \'%s\\n\' "$*" >> "$NPM_ARGS_LOG"',
        'if [ "$1" = "view" ]; then',
        '  printf \'%s\\n\' \'{"integrity":"sha512-test","signatures":[{"keyid":"SHA256:test","sig":"test"}],"attestations":{"url":"https://registry.npmjs.org/-/npm/v1/attestations/@capsule-sdk%2fpublic-package@1.2.3","provenance":{"predicateType":"https://slsa.dev/provenance/v1"}}}\'',
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

    assert.match(stdout, /Published provenance attestation metadata check passed/);
    assert.match(stdout, /@capsule-sdk\/public-package@1\.2\.3: provenance attestation metadata present/);
    assert.match(stdout, /not cryptographically verified/);
    assert.match(execFileSync("cat", [npmArgsLog], { encoding: "utf8" }), /view @capsule-sdk\/public-package@1\.2\.3 dist --json/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

const pkg = { name: "@capsule-sdk/public-package", version: "1.2.3" };
const signatures = [{ keyid: "SHA256:fixture", sig: "fixture-signature" }];
const attestations = {
  url: "https://registry.npmjs.org/-/npm/v1/attestations/@capsule-sdk%2fpublic-package@1.2.3",
  provenance: { predicateType: "https://slsa.dev/provenance/v1" }
};

test("REL-01: registry signatures alone are not provenance", () => {
  const result = classifyPublishedDist({ integrity: "sha512-fixture", signatures }, pkg);
  assert.equal(result.ok, false);
  assert.equal(result.signatures, "present");
  assert.equal(result.attestation, "missing");
  assert.equal(result.identity, "not-verified");
});

test("REL-01: malformed attestation metadata is rejected", () => {
  const cases = [
    { attestations: {} },
    { attestations: { ...attestations, provenance: undefined } },
    { attestations: { ...attestations, provenance: { predicateType: "https://example.com/not-slsa" } } },
    { attestations: { ...attestations, url: "http://registry.npmjs.org/-/npm/v1/attestations/@capsule-sdk%2fpublic-package@1.2.3" } },
    { attestations: { ...attestations, url: "https://registry.example.com/-/npm/v1/attestations/@capsule-sdk%2fpublic-package@1.2.3" } },
    { attestations: { ...attestations, url: "https://registry.npmjs.org/-/npm/v1/attestations/@capsule-sdk%2fother@1.2.3" } },
    { attestations: { ...attestations, url: "https://registry.npmjs.org/-/npm/v1/attestations/@capsule-sdk%2fpublic-package@9.9.9" } },
    { attestations: { ...attestations, url: "not a url" } },
    { attestations: "present" },
    { provenance: true }
  ];
  for (const dist of cases) {
    const result = classifyPublishedDist({ signatures, ...dist }, pkg);
    assert.equal(result.ok, false, JSON.stringify(dist));
    assert.notEqual(result.attestation, "present", JSON.stringify(dist));
  }
  assert.equal(classifyPublishedDist(null, pkg).ok, false);
  assert.equal(classifyPublishedDist([], pkg).ok, false);
  assert.equal(classifyPublishedDist([{ attestations }, { attestations }], pkg).ok, false);
});

test("REL-01: SLSA provenance attestation metadata passes as presence only, in object or single-element array form", () => {
  for (const dist of [{ signatures, attestations }, [{ signatures, attestations }]]) {
    const result = classifyPublishedDist(dist, pkg);
    assert.equal(result.ok, true);
    assert.equal(result.attestation, "present");
    assert.equal(result.identity, "not-verified");
  }
  const withoutSignatures = classifyPublishedDist(
    { attestations: { ...attestations, provenance: { predicateType: "https://slsa.dev/provenance/v0.2" } } },
    pkg
  );
  assert.equal(withoutSignatures.ok, true);
  assert.equal(withoutSignatures.signatures, "missing");
});

test("REL-01: real mode fails a signature-only package with a named reason", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-provenance-test-"));
  try {
    const publicPackageDir = join(fixtureRoot, "packages", "public-package");
    const fakeBinDir = join(fixtureRoot, "bin");
    mkdirSync(publicPackageDir, { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeJson(join(publicPackageDir, "package.json"), pkg);
    writeFileSync(
      join(fakeBinDir, "npm"),
      ["#!/usr/bin/env sh", `printf '%s\\n' '${JSON.stringify({ integrity: "sha512-test", signatures })}'`, "exit 0", ""].join("\n"),
      { mode: 0o755 }
    );
    let failure;
    try {
      execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--no-dry-run"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` }
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "signature-only metadata must fail");
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /provenance attestation missing/);
    assert.match(failure.stderr, /registry signatures present but are not provenance/);
    assert.doesNotMatch(failure.stdout, /verification passed/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
