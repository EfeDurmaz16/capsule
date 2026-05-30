import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    dryRun: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const root = argv[index + 1];
      if (!root) {
        throw new Error("--root requires a path.");
      }
      options.root = root;
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-dry-run") {
      options.dryRun = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function publicPackages(root) {
  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir)
    .map((dir) => {
      const packageJsonPath = join(packagesDir, dir, "package.json");
      return { dir, packageJsonPath };
    })
    .filter((entry) => existsSync(entry.packageJsonPath))
    .map((entry) => ({ ...entry, pkg: readJson(entry.packageJsonPath) }))
    .filter((entry) => entry.pkg.private !== true)
    .map((entry) => ({ name: entry.pkg.name, version: entry.pkg.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function npmViewDist(pkg) {
  const output = execFileSync("npm", ["view", `${pkg.name}@${pkg.version}`, "dist", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function hasProvenanceMetadata(dist) {
  return Boolean(
    dist?.attestations?.provenance ||
      dist?.attestations?.url ||
      dist?.provenance ||
      dist?.signatures?.some?.((signature) => typeof signature?.keyid === "string" && typeof signature?.sig === "string")
  );
}

function printHelp() {
  console.log(`Usage: node scripts/verify-published-provenance.mjs [--root <path>] [--dry-run|--no-dry-run]

Verifies npm provenance-like metadata for every public package in packages/*.

Default mode is --dry-run so the command is safe before first publication.`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const packages = publicPackages(options.root);

if (options.dryRun) {
  console.log(`Provenance verification dry-run for ${packages.length} public packages:`);
  for (const pkg of packages) {
    console.log(`- ${pkg.name}@${pkg.version}`);
  }
  process.exit(0);
}

const failures = [];

for (const pkg of packages) {
  try {
    const dist = npmViewDist(pkg);
    if (!hasProvenanceMetadata(dist)) {
      failures.push(`${pkg.name}@${pkg.version}: provenance metadata missing`);
      continue;
    }
    console.log(`${pkg.name}@${pkg.version}: provenance metadata present`);
  } catch (error) {
    failures.push(`${pkg.name}@${pkg.version}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error("Published provenance verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Published provenance verification passed for ${packages.length} packages.`);
