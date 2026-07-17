import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "package-publish-audit.mjs");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validPackageJson(overrides = {}) {
  return {
    name: "@capsule/fixture",
    version: "1.2.3",
    type: "module",
    description: "Capsule fixture package for publish metadata tests.",
    license: "MIT",
    repository: {
      type: "git",
      url: "https://github.com/capsule/runtime.git",
      directory: "packages/fixture"
    },
    homepage: "https://github.com/capsule/runtime/tree/main/packages/fixture#readme",
    bugs: {
      url: "https://github.com/capsule/runtime/issues"
    },
    keywords: ["capsule", "agent", "runtime", "policy"],
    engines: {
      node: ">=20"
    },
    publishConfig: {
      access: "public"
    },
    files: ["dist"],
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        import: "./dist/index.js",
        types: "./dist/index.d.ts"
      }
    },
    ...overrides
  };
}

function writeFixtureRoot(mutator = () => {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "capsule-publish-audit-test-"));
  const packageDir = join(fixtureRoot, "packages", "fixture");
  const privatePackageDir = join(fixtureRoot, "packages", "test-utils");
  const exampleDir = join(fixtureRoot, "examples", "demo");

  mkdirSync(join(packageDir, "dist"), { recursive: true });
  mkdirSync(privatePackageDir, { recursive: true });
  mkdirSync(exampleDir, { recursive: true });
  mkdirSync(join(fixtureRoot, ".changeset"), { recursive: true });

  writeFileSync(join(packageDir, "dist", "index.js"), "export const ok = true;\n");
  writeFileSync(join(packageDir, "dist", "index.d.ts"), "export declare const ok: true;\n");
  writeJson(join(packageDir, "package.json"), validPackageJson());
  writeJson(join(privatePackageDir, "package.json"), {
    name: "@capsule/test-utils",
    version: "1.2.3",
    private: true
  });
  writeJson(join(exampleDir, "package.json"), {
    name: "@capsule/example-demo",
    version: "1.2.3",
    private: true
  });
  writeJson(join(fixtureRoot, ".changeset", "config.json"), {
    ignore: ["@capsule/test-utils", "@capsule/example-demo"]
  });

  mutator({ fixtureRoot, packageDir, privatePackageDir, exampleDir });

  return fixtureRoot;
}

test("dry-run passes for publishable package metadata", () => {
  const fixtureRoot = writeFixtureRoot();

  try {
    const stdout = execFileSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--dry-run"], {
      encoding: "utf8"
    });

    assert.match(stdout, /Package publish metadata dry-run audit passed for 1 public packages\./);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("dry-run rejects missing metadata, private publish access, and dist test artifacts", () => {
  const fixtureRoot = writeFixtureRoot(({ packageDir }) => {
    writeJson(
      join(packageDir, "package.json"),
      validPackageJson({
        description: "too short",
        license: "Apache-2.0",
        publishConfig: {
          access: "restricted"
        }
      })
    );
    writeFileSync(join(packageDir, "dist", "index.test.js"), "export const leaked = true;\n");
  });

  try {
    const result = spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--dry-run"], {
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Package publish audit failed:/);
    assert.match(result.stderr, /description must be a useful string/);
    assert.match(result.stderr, /license must be MIT/);
    assert.match(result.stderr, /publishConfig\.access must be public/);
    assert.match(result.stderr, /publishable dist contains test artifact dist\/index\.test\.js/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("dry-run rejects public examples and private packages missing Changesets ignore", () => {
  const fixtureRoot = writeFixtureRoot(({ fixtureRoot, exampleDir }) => {
    writeJson(join(exampleDir, "package.json"), {
      name: "@capsule/example-demo",
      version: "1.2.3"
    });
    writeJson(join(fixtureRoot, ".changeset", "config.json"), {
      ignore: []
    });
  });

  try {
    const result = spawnSync(process.execPath, [scriptPath, "--root", fixtureRoot, "--dry-run"], {
      encoding: "utf8"
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /@capsule\/example-demo: examples must remain private/);
    assert.match(result.stderr, /@capsule\/test-utils: private workspace package must be listed in \.changeset\/config\.json ignore/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
