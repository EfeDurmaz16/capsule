import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

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
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/dependency-license-audit.mjs [--root <path>]

Audits public Capsule package runtime dependencies and production dependency
licenses without adding a package-scanner dependency.`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const root = options.root;
const packagesDir = join(root, "packages");
const allowedRuntimeDependencies = {
  "@capsule-sdk/adapter-cloud-run": ["google-auth-library"],
  "@capsule-sdk/adapter-daytona": ["@daytona/sdk"],
  "@capsule-sdk/adapter-e2b": ["e2b"],
  "@capsule-sdk/adapter-ec2": ["@aws-sdk/client-ec2"],
  "@capsule-sdk/adapter-ecs": ["@aws-sdk/client-ecs"],
  "@capsule-sdk/adapter-kubernetes": ["@kubernetes/client-node"],
  "@capsule-sdk/adapter-lambda": ["@aws-sdk/client-lambda"],
  "@capsule-sdk/adapter-modal": ["modal"]
};
const allowedLicenseTerms = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0", "ISC", "MIT", "Python-2.0", "Unlicense"]);
const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function publicPackages() {
  if (!existsSync(packagesDir)) {
    errors.push(`missing packages directory at ${packagesDir}.`);
    return [];
  }

  return readdirSync(packagesDir)
    .map((dir) => ({ dir, packageDir: join(packagesDir, dir), packageJsonPath: join(packagesDir, dir, "package.json") }))
    .filter((entry) => existsSync(entry.packageJsonPath))
    .map((entry) => ({ ...entry, pkg: readJson(entry.packageJsonPath) }))
    .filter((entry) => entry.pkg.private !== true)
    .sort((left, right) => left.pkg.name.localeCompare(right.pkg.name));
}

function externalRuntimeDependencies(pkg) {
  return Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) })
    .filter((name) => !name.startsWith("@capsule-sdk/"))
    .sort((left, right) => left.localeCompare(right));
}

function auditRuntimeDependencyAllowlist(packages) {
  for (const { pkg, packageJsonPath } of packages) {
    const allowed = new Set(allowedRuntimeDependencies[pkg.name] ?? []);
    for (const dependencyName of externalRuntimeDependencies(pkg)) {
      if (!allowed.has(dependencyName)) {
        errors.push(`${pkg.name}: unexpected runtime dependency ${dependencyName} in ${relative(root, packageJsonPath)}.`);
      }
    }
  }
}

function stripOuterParens(expression) {
  let value = expression.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function splitTopLevel(expression, operator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const delimiter = ` ${operator} `;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && expression.slice(index, index + delimiter.length) === delimiter) {
      parts.push(expression.slice(start, index));
      start = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }

  if (parts.length === 0) {
    return [];
  }

  parts.push(expression.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function licenseExpressionAllowed(expression) {
  const value = stripOuterParens(expression);
  if (!value || /^unknown$/i.test(value)) {
    return false;
  }

  const orParts = splitTopLevel(value, "OR");
  if (orParts.length > 0) {
    return orParts.some((part) => licenseExpressionAllowed(part));
  }

  const andParts = splitTopLevel(value, "AND");
  if (andParts.length > 0) {
    return andParts.every((part) => licenseExpressionAllowed(part));
  }

  if (value.includes(" WITH ")) {
    return false;
  }

  return allowedLicenseTerms.has(value);
}

function runPnpmLicenses() {
  try {
    return JSON.parse(execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: root, encoding: "utf8" }));
  } catch (error) {
    throw new Error("Failed to read production dependency licenses with pnpm.", { cause: error });
  }
}

function auditLicenses(licenseGroups) {
  for (const [licenseExpression, packages] of Object.entries(licenseGroups)) {
    if (licenseExpressionAllowed(licenseExpression)) {
      continue;
    }

    const packageNames = packages
      .map((pkg) => `${pkg.name}@${(pkg.versions ?? []).join(",") || "unknown"}`)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 12);
    errors.push(`license ${licenseExpression} is not allowlisted for ${packageNames.join(", ")}.`);
  }
}

const packages = publicPackages();
auditRuntimeDependencyAllowlist(packages);
auditLicenses(runPnpmLicenses());

if (errors.length > 0) {
  console.error("Dependency and license audit failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const externalDependencyCount = packages.reduce((count, { pkg }) => count + externalRuntimeDependencies(pkg).length, 0);
console.log(`Dependency and license audit passed for ${packages.length} public packages and ${externalDependencyCount} external runtime dependencies.`);
