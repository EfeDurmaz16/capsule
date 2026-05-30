import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const options = {
    root: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a path.");
      }
      options.root = value;
      index += 1;
    } else if (arg === "--dry-run") {
      continue;
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/package-publish-audit.mjs [--root <path>] [--dry-run]

Audits publishable Capsule package metadata without contacting npm. This is a
dry-run release gate for manifest shape, package entrypoints, publishConfig
access, dist hygiene, private workspace ignore rules, and example privacy.`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const root = options.root;
const packagesDir = join(root, "packages");
const examplesDir = join(root, "examples");
const changesetConfigPath = join(root, ".changeset", "config.json");
const allowedFiles = ["dist"];
const requiredPackageFields = ["description", "license", "repository", "homepage", "bugs", "keywords", "engines"];
const errors = [];
let auditedPublicPackages = 0;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function auditPackage(packageDir) {
  const packageJsonPath = join(packageDir, "package.json");
  const pkg = readJson(packageJsonPath);

  if (pkg.private === true) {
    return;
  }

  auditedPublicPackages += 1;

  if (!pkg.name?.startsWith("@capsule/")) {
    errors.push(`${pkg.name ?? packageDir}: public package name must use @capsule scope.`);
  }

  for (const field of requiredPackageFields) {
    if (pkg[field] === undefined) {
      errors.push(`${pkg.name}: missing required metadata field ${field}.`);
    }
  }

  if (typeof pkg.description !== "string" || pkg.description.trim().length < 20) {
    errors.push(`${pkg.name}: description must be a useful string.`);
  }

  if (pkg.license !== "Apache-2.0") {
    errors.push(`${pkg.name}: license must be Apache-2.0.`);
  }

  if (pkg.repository?.type !== "git" || typeof pkg.repository?.url !== "string" || typeof pkg.repository?.directory !== "string") {
    errors.push(`${pkg.name}: repository must include type, url, and package directory.`);
  }

  if (typeof pkg.homepage !== "string" || !pkg.homepage.startsWith("https://github.com/")) {
    errors.push(`${pkg.name}: homepage must point at the GitHub README.`);
  }

  if (typeof pkg.bugs?.url !== "string" || !pkg.bugs.url.endsWith("/issues")) {
    errors.push(`${pkg.name}: bugs.url must point at the GitHub issues page.`);
  }

  if (!Array.isArray(pkg.keywords) || pkg.keywords.length < 4 || !pkg.keywords.every((keyword) => typeof keyword === "string" && keyword.length > 0)) {
    errors.push(`${pkg.name}: keywords must include at least four non-empty strings.`);
  }

  if (typeof pkg.engines?.node !== "string" || !pkg.engines.node.startsWith(">=")) {
    errors.push(`${pkg.name}: engines.node must declare a minimum Node.js version.`);
  }

  if (pkg.publishConfig?.access !== "public") {
    errors.push(`${pkg.name}: publishConfig.access must be public.`);
  }

  if (JSON.stringify(pkg.files) !== JSON.stringify(allowedFiles)) {
    errors.push(`${pkg.name}: files must be ${JSON.stringify(allowedFiles)}.`);
  }

  for (const field of ["main", "types"]) {
    const value = pkg[field];
    if (!value?.startsWith("./dist/")) {
      errors.push(`${pkg.name}: ${field} must point at ./dist.`);
      continue;
    }
    if (!existsSync(join(packageDir, value))) {
      errors.push(`${pkg.name}: ${field} target is missing; run pnpm build before publish.`);
    }
  }

  const rootExport = pkg.exports?.["."];
  if (rootExport?.import !== pkg.main) {
    errors.push(`${pkg.name}: exports["."].import must match main.`);
  }
  if (rootExport?.types !== pkg.types) {
    errors.push(`${pkg.name}: exports["."].types must match types.`);
  }

  if (pkg.bin) {
    for (const [name, value] of Object.entries(pkg.bin)) {
      if (!value.startsWith("./dist/")) {
        errors.push(`${pkg.name}: bin ${name} must point at ./dist.`);
        continue;
      }
      if (!existsSync(join(packageDir, value))) {
        errors.push(`${pkg.name}: bin ${name} target is missing; run pnpm build before publish.`);
      }
    }
  }

  for (const distFile of listFiles(join(packageDir, "dist"))) {
    if (distFile.includes(".test.")) {
      errors.push(`${pkg.name}: publishable dist contains test artifact ${distFile.slice(packageDir.length + 1)}.`);
    }
  }
}

const changesetConfig = existsSync(changesetConfigPath) ? readJson(changesetConfigPath) : {};
const changesetIgnore = new Set(changesetConfig.ignore ?? []);
const privateWorkspacePackages = [];

if (!existsSync(packagesDir)) {
  errors.push(`missing packages directory at ${packagesDir}.`);
} else {
  for (const dir of readdirSync(packagesDir)) {
    const packageDir = join(packagesDir, dir);
    if (existsSync(join(packageDir, "package.json"))) {
      const pkg = readJson(join(packageDir, "package.json"));
      if (pkg.private === true && typeof pkg.name === "string") {
        privateWorkspacePackages.push(pkg.name);
      }
      auditPackage(packageDir);
    }
  }
}

if (existsSync(examplesDir)) {
  for (const dir of readdirSync(examplesDir)) {
    const packageJsonPath = join(examplesDir, dir, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const pkg = readJson(packageJsonPath);
    if (pkg.private !== true) {
      errors.push(`${pkg.name ?? `examples/${dir}`}: examples must remain private.`);
    } else if (typeof pkg.name === "string") {
      privateWorkspacePackages.push(pkg.name);
    }
  }
}

for (const packageName of privateWorkspacePackages) {
  if (!changesetIgnore.has(packageName)) {
    errors.push(`${packageName}: private workspace package must be listed in .changeset/config.json ignore.`);
  }
}

if (errors.length > 0) {
  console.error("Package publish audit failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Package publish metadata dry-run audit passed for ${auditedPublicPackages} public packages.`);
