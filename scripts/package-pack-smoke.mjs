import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function publicPackages() {
  return readdirSync(packagesDir)
    .map((dir) => ({ dir, packageDir: join(packagesDir, dir), packageJsonPath: join(packagesDir, dir, "package.json") }))
    .filter((entry) => existsSync(entry.packageJsonPath))
    .map((entry) => ({ ...entry, pkg: readJson(entry.packageJsonPath) }))
    .filter((entry) => entry.pkg.private !== true)
    .sort((left, right) => left.pkg.name.localeCompare(right.pkg.name));
}

function parsePackOutput(output) {
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...options.env }
  });
}

function packPackages(packages, packDir) {
  return packages.map(({ packageDir, pkg }) => {
    const output = run("pnpm", ["--dir", packageDir, "pack", "--pack-destination", packDir, "--json"]);
    const packed = parsePackOutput(output);
    if (!packed?.filename) {
      throw new Error(`pnpm pack did not return a tarball filename for ${pkg.name}.`);
    }
    return { name: pkg.name, filename: packed.filename };
  });
}

function writeFixture(fixtureDir, tarballs) {
  const dependencies = Object.fromEntries(tarballs.map((tarball) => [tarball.name, `file:${tarball.filename}`]));
  writeFileSync(
    join(fixtureDir, "package.json"),
    `${JSON.stringify(
      {
        name: "capsule-pack-smoke-fixture",
        private: true,
        type: "module",
        dependencies,
        pnpm: {
          overrides: dependencies
        }
      },
      null,
      2
    )}\n`
  );
}

function writeImportSmoke(fixtureDir, packageNames) {
  writeFileSync(
    join(fixtureDir, "smoke.mjs"),
    `const packageNames = ${JSON.stringify(packageNames, null, 2)};\nfor (const name of packageNames) {\n  const mod = await import(name);\n  if (Object.keys(mod).length === 0) {\n    throw new Error(\`Package \${name} did not expose any exports.\`);\n  }\n}\nconsole.log(\`Imported \${packageNames.length} Capsule packages from packed artifacts.\`);\n`
  );
}

function smokeCliBin(fixtureDir) {
  const output = run("pnpm", ["exec", "capsule", "capabilities"], { cwd: fixtureDir });
  const capabilities = JSON.parse(output);
  if (capabilities.sandbox?.create !== "native" || capabilities.job?.run !== "native") {
    throw new Error("Packed capsule CLI did not execute against the default Docker adapter capabilities.");
  }
}

const packages = publicPackages();
const tempRoot = mkdtempSync(join(tmpdir(), "capsule-pack-smoke-"));
const packDir = join(tempRoot, "packs");
const fixtureDir = join(tempRoot, "fixture");

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });
  const tarballs = packPackages(packages, packDir);
  writeFixture(fixtureDir, tarballs);
  writeImportSmoke(fixtureDir, tarballs.map((tarball) => tarball.name));
  run("pnpm", ["install", "--ignore-scripts", "--no-frozen-lockfile"], { cwd: fixtureDir, stdio: "inherit" });
  run("node", ["smoke.mjs"], { cwd: fixtureDir, stdio: "inherit" });
  smokeCliBin(fixtureDir);
  console.log(`Package pack smoke passed for ${tarballs.length} packages in ${basename(tempRoot)}.`);
} finally {
  if (process.env.CAPSULE_KEEP_PACK_SMOKE !== "1") {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept package pack smoke fixture at ${tempRoot}`);
  }
}
