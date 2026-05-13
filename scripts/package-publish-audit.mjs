import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");
const examplesDir = join(root, "examples");
const allowedFiles = ["dist"];
const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function auditPackage(packageDir) {
  const packageJsonPath = join(packageDir, "package.json");
  const pkg = readJson(packageJsonPath);

  if (pkg.private === true) {
    return;
  }

  if (!pkg.name?.startsWith("@capsule/")) {
    errors.push(`${pkg.name ?? packageDir}: public package name must use @capsule scope.`);
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

  if (pkg.bin) {
    for (const [name, value] of Object.entries(pkg.bin)) {
      if (!value.startsWith("./dist/")) {
        errors.push(`${pkg.name}: bin ${name} must point at ./dist.`);
      }
    }
  }
}

for (const dir of readdirSync(packagesDir)) {
  const packageDir = join(packagesDir, dir);
  if (existsSync(join(packageDir, "package.json"))) {
    auditPackage(packageDir);
  }
}

for (const dir of readdirSync(examplesDir)) {
  const packageJsonPath = join(examplesDir, dir, "package.json");
  if (!existsSync(packageJsonPath)) {
    continue;
  }
  const pkg = readJson(packageJsonPath);
  if (pkg.private !== true) {
    errors.push(`${pkg.name ?? `examples/${dir}`}: examples must remain private.`);
  }
}

if (errors.length > 0) {
  console.error("Package publish audit failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Package publish audit passed.");
