import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// What this script checks, precisely: that npm registry metadata for each published version
// advertises a SLSA provenance attestation for that exact package and version. It does NOT fetch or
// cryptographically verify the attestation bundle, and it does NOT check the source repository, ref
// or workflow identity inside it. Registry signatures (dist.signatures) are reported separately and are
// never accepted as provenance. For cryptographic verification, install the exact versions and run
// `npm audit signatures`.
const attestationUrlPrefix = "https://registry.npmjs.org/-/npm/v1/attestations/";
const slsaProvenancePredicateTypes = new Set(["https://slsa.dev/provenance/v1", "https://slsa.dev/provenance/v0.2"]);

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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attestationProblem(attestations, pkg) {
  if (attestations === undefined) return "missing";
  if (!isRecord(attestations)) return "malformed: dist.attestations is not an object";
  if (typeof attestations.url !== "string") return "malformed: dist.attestations.url is missing";
  if (!attestations.url.startsWith(attestationUrlPrefix)) return `malformed: dist.attestations.url is not under ${attestationUrlPrefix}`;
  let subject;
  try {
    subject = decodeURIComponent(new URL(attestations.url).pathname.slice(new URL(attestationUrlPrefix).pathname.length));
  } catch {
    return "malformed: dist.attestations.url is not a valid URL";
  }
  if (subject !== `${pkg.name}@${pkg.version}`) return `malformed: dist.attestations.url names ${JSON.stringify(subject)}, expected ${pkg.name}@${pkg.version}`;
  if (!isRecord(attestations.provenance)) return "malformed: dist.attestations.provenance is missing";
  if (!slsaProvenancePredicateTypes.has(attestations.provenance.predicateType))
    return "malformed: dist.attestations.provenance.predicateType is not SLSA provenance";
  return undefined;
}

// Classifies `npm view <pkg>@<version> dist --json` output. Some npm versions print a single-element
// array for an exact version; anything else that is not one object is malformed.
export function classifyPublishedDist(rawDist, pkg) {
  const dist = Array.isArray(rawDist) && rawDist.length === 1 ? rawDist[0] : rawDist;
  if (!isRecord(dist)) {
    return {
      ok: false,
      signatures: "missing",
      attestation: "malformed",
      identity: "not-verified",
      reason: "malformed: npm view did not return one dist object"
    };
  }
  const signatures =
    Array.isArray(dist.signatures) && dist.signatures.some((signature) => typeof signature?.keyid === "string" && typeof signature?.sig === "string")
      ? "present"
      : "missing";
  const problem = attestationProblem(dist.attestations, pkg);
  if (problem === undefined) {
    return { ok: true, signatures, attestation: "present", identity: "not-verified" };
  }
  const attestation = problem === "missing" ? "missing" : "malformed";
  const reason =
    problem === "missing"
      ? `provenance attestation missing${signatures === "present" ? "; registry signatures present but are not provenance" : ""}`
      : `provenance attestation ${problem}`;
  return { ok: false, signatures, attestation, identity: "not-verified", reason };
}

function printHelp() {
  console.log(`Usage: node scripts/verify-published-provenance.mjs [--root <path>] [--dry-run|--no-dry-run]

Checks that npm registry metadata for every public package in packages/* advertises a SLSA
provenance attestation for that exact package and version (presence check only).

It does not cryptographically verify the attestation or check the source repository, ref or
workflow identity inside it, and registry signatures alone never pass. To verify signatures and
attestations cryptographically, install the exact versions and run "npm audit signatures".

Default mode is --dry-run so the command is safe before first publication.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const packages = publicPackages(options.root);

  if (options.dryRun) {
    console.log(`Provenance attestation metadata check dry-run for ${packages.length} public packages:`);
    for (const pkg of packages) {
      console.log(`- ${pkg.name}@${pkg.version}`);
    }
    process.exit(0);
  }

  const failures = [];

  for (const pkg of packages) {
    try {
      const dist = npmViewDist(pkg);
      const result = classifyPublishedDist(dist, pkg);
      if (!result.ok) {
        failures.push(`${pkg.name}@${pkg.version}: ${result.reason}`);
        continue;
      }
      console.log(
        `${pkg.name}@${pkg.version}: provenance attestation metadata present (registry signatures ${result.signatures}); not cryptographically verified, repository/ref identity not checked`
      );
    } catch (error) {
      failures.push(`${pkg.name}@${pkg.version}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    console.error("Published provenance attestation metadata check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `Published provenance attestation metadata check passed for ${packages.length} packages (presence only; run "npm audit signatures" on an install of these versions for cryptographic verification).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
