import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { expect, hello, request, startWorker } from "./bridge-worker-client.mjs";
import { packedEntryViolations } from "./packed-file-policy.mjs";

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    nodeVersion: process.versions.node,
    respectEngines: false,
    listPackages: false
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
    } else if (arg === "--node-version") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--node-version requires a version.");
      }
      options.nodeVersion = value;
      index += 1;
    } else if (arg === "--respect-engines") {
      options.respectEngines = true;
    } else if (arg === "--list-packages") {
      options.listPackages = true;
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/package-pack-smoke.mjs [--root <path>] [--respect-engines] [--node-version <version>] [--list-packages]

Packs public Capsule packages, installs them into a temporary fixture, imports
the packed artifacts, and runs the packed CLI. With --respect-engines, packages
whose engines.node minimum is above the current Node version are skipped; this is
used by Node compatibility CI while the full release audit still runs all public
packages on Node 24.`);
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const root = options.root;
const packagesDir = join(root, "packages");
const kib = 1024;
// Packed tarball budgets are rounded up from current pnpm pack artifacts.
const packedSizeBudgetBytes = {
  "@capsule-sdk/azure": 11 * kib,
  "@capsule-sdk/cloud-run": 14 * kib,
  "@capsule-sdk/cloudflare": 11 * kib,
  "@capsule-sdk/daytona": 6 * kib,
  "@capsule-sdk/docker": 11 * kib,
  "@capsule-sdk/e2b": 6 * kib,
  "@capsule-sdk/ec2": 6 * kib,
  "@capsule-sdk/ecs": 8 * kib,
  "@capsule-sdk/fly": 9 * kib,
  "@capsule-sdk/kubernetes": 13 * kib,
  "@capsule-sdk/lambda": 6 * kib,
  "@capsule-sdk/mock": 10 * kib,
  "@capsule-sdk/modal": 6 * kib,
  "@capsule-sdk/neon": 9 * kib,
  "@capsule-sdk/vercel": 13 * kib,
  "@capsule-sdk/ai": 6 * kib,
  "@capsule-sdk/bridge-worker": 40 * kib,
  "@capsule-sdk/cli": 32 * kib,
  "@capsule-sdk/core": 60 * kib,
  "@capsule-sdk/presets": 7 * kib,
  "@capsule-sdk/preview": 14 * kib,
  "@capsule-sdk/store-jsonl": 4 * kib,
  "@capsule-sdk/store-sqlite": 5 * kib
};

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

function parseVersion(version) {
  const match = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    throw new Error(`Invalid Node.js version: ${version}`);
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function parseMinimumNodeVersion(range, packageName) {
  if (typeof range !== "string" || range.trim() === "") {
    return undefined;
  }
  const match = range.trim().match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`${packageName}: unsupported engines.node range ${JSON.stringify(range)} for pack smoke engine filtering.`);
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function splitPackagesByEngine(packages, nodeVersion) {
  const current = parseVersion(nodeVersion);
  const included = [];
  const skipped = [];

  for (const entry of packages) {
    const minimum = parseMinimumNodeVersion(entry.pkg.engines?.node, entry.pkg.name);
    if (minimum && compareVersions(current, minimum) < 0) {
      skipped.push({ name: entry.pkg.name, enginesNode: entry.pkg.engines.node });
    } else {
      included.push(entry);
    }
  }

  return { included, skipped };
}

function parsePackOutput(output) {
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function formatBytes(bytes) {
  return `${bytes} B (${(bytes / kib).toFixed(1)} KiB)`;
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
    const filename = isAbsolute(packed.filename) ? packed.filename : join(packDir, packed.filename);
    return { name: pkg.name, main: pkg.main, filename, sizeBytes: statSync(filename).size };
  });
}

function checkPackedContents(tarballs) {
  const errors = tarballs.flatMap((tarball) =>
    packedEntryViolations(tarball.name, run("tar", ["-tzf", tarball.filename]).split(/\r?\n/), { main: tarball.main })
  );
  if (errors.length === 0) {
    return true;
  }
  console.error("Packed package contents check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  return false;
}

function checkPackedSizeBudgets(tarballs) {
  const errors = [];
  for (const tarball of tarballs) {
    const budgetBytes = packedSizeBudgetBytes[tarball.name];
    if (budgetBytes === undefined) {
      errors.push(`${tarball.name}: actual ${formatBytes(tarball.sizeBytes)}, budget missing, tarball ${tarball.filename}`);
    } else if (tarball.sizeBytes > budgetBytes) {
      errors.push(`${tarball.name}: actual ${formatBytes(tarball.sizeBytes)}, budget ${formatBytes(budgetBytes)}, tarball ${tarball.filename}`);
    }
  }

  if (errors.length === 0) {
    return true;
  }

  console.error("Package packed size budget failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  return false;
}

function writeFixture(fixtureDir, tarballs) {
  const rootPackage = readJson(join(root, "package.json"));
  const dependencies = Object.fromEntries(tarballs.map((tarball) => [tarball.name, `file:${tarball.filename}`]));
  writeFileSync(
    join(fixtureDir, "package.json"),
    `${JSON.stringify(
      {
        name: "capsule-pack-smoke-fixture",
        private: true,
        type: "module",
        packageManager: rootPackage.packageManager,
        dependencies
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(fixtureDir, "pnpm-workspace.yaml"),
    `overrides:\n${Object.entries(dependencies)
      .map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
      .join("\n")}\n`
  );
}

function writeImportSmoke(fixtureDir, packageNames) {
  writeFileSync(
    join(fixtureDir, "smoke.mjs"),
    `const packageNames = ${JSON.stringify(packageNames, null, 2)};\nfor (const name of packageNames) {\n  const mod = await import(name);\n  if (Object.keys(mod).length === 0) {\n    throw new Error(\`Package \${name} did not expose any exports.\`);\n  }\n}\nconsole.log(\`Imported \${packageNames.length} Capsule packages from packed artifacts.\`);\n`
  );
}

function smokeCliBin(fixtureDir) {
  const output = run("pnpm", ["exec", "capsule", "capabilities", "--json"], { cwd: fixtureDir });
  const report = JSON.parse(output);
  if (report.adapter !== "docker" || report.capabilities?.sandbox?.create !== "native" || report.capabilities?.job?.run !== "native") {
    throw new Error("Packed capsule CLI did not execute against the default Docker adapter capabilities.");
  }
}

// Runs the packed capsule-bridge-worker bin from the fixture install, outside the repository, on real
// pipes: a governed create, exec and destroy on the fixture profile, a refusal that must have no
// effect, then end of input and a clean exit; and an oversize hello refused from its length alone.
async function smokeBridgeWorkerBin(fixtureDir) {
  const bin = join(fixtureDir, "node_modules", "@capsule-sdk", "bridge-worker", "dist", "bin.js");
  const configPath = join(fixtureDir, "bridge-worker-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      binding: { account: "acct-a", project: "proj-1" },
      policy: { images: ["fixture/ok"] },
      approvals: [{ ref: "apr-destroy", action: "sandbox.destroy", native_id: null }]
    })
  );
  const start = () =>
    startWorker({ command: process.execPath, args: [bin, "--profile", "fixture", "--config", configPath], cwd: fixtureDir, env: { PATH: "" } });
  const worker = start();
  worker.send(hello("fixture"));
  expect((await worker.next()).type === "hello_ack", "packed bridge worker did not acknowledge hello");
  worker.send(request(1, "sandbox.create", { params: { image: "fixture/forbidden", env: {}, secret_names: [], labels: {} } }));
  const denied = await worker.next();
  expect(denied.type === "error" && denied.error.code === "denied" && denied.error.effect === "none", "packed bridge worker did not refuse before effect");
  worker.send(request(2, "sandbox.create", { params: { image: "fixture/ok", env: {}, secret_names: [], labels: {} } }));
  const created = await worker.next();
  expect(created.type === "result" && created.state === "completed", "packed bridge worker did not create");
  const target = created.resource;
  worker.send(
    request(3, "sandbox.exec", {
      target,
      params: { argv: ["echo", "packed"], stdin: null, cwd: null, timeout_ms: 1000, max_output_bytes: 64, secret_names: [] }
    })
  );
  const executed = await worker.next();
  expect(executed.type === "result" && executed.output.stdout.text === "packed\n", "packed bridge worker did not exec");
  worker.send(request(4, "sandbox.destroy", { target, params: {}, approval: { ref: "apr-destroy" } }));
  const destroyed = await worker.next();
  expect(destroyed.type === "result" && destroyed.output.status === "destroyed", "packed bridge worker did not destroy");
  worker.end();
  const { code } = await worker.exit;
  expect(code === 0, `packed bridge worker exited ${code} after end of input`);

  const oversize = start();
  const header = Buffer.alloc(4);
  header.writeUInt32LE((1 << 20) + 1, 0);
  oversize.sendBytes(header);
  const refused = await oversize.next();
  expect(refused.type === "protocol_error" && refused.code === "oversize", "packed bridge worker did not refuse an oversize hello");
  expect((await oversize.exit).code === 2, "packed bridge worker did not exit 2 after a framing error");
  console.log("Packed capsule-bridge-worker passed the fixture round trip, a refusal before effect and an oversize hello.");
}

const allPackages = publicPackages();
const { included: packages, skipped } = options.respectEngines
  ? splitPackagesByEngine(allPackages, options.nodeVersion)
  : { included: allPackages, skipped: [] };

if (options.respectEngines && skipped.length > 0) {
  for (const entry of skipped) {
    console.log(`Skipping ${entry.name}; engines.node ${entry.enginesNode} is not satisfied by Node ${options.nodeVersion}.`);
  }
}

if (options.listPackages) {
  for (const entry of packages) {
    console.log(entry.pkg.name);
  }
  process.exit(0);
}

if (packages.length === 0) {
  throw new Error("No public packages selected for package pack smoke.");
}

const tempRoot = mkdtempSync(join(tmpdir(), "capsule-pack-smoke-"));
const packDir = join(tempRoot, "packs");
const fixtureDir = join(tempRoot, "fixture");
let failed = false;

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });
  const tarballs = packPackages(packages, packDir);
  const contentsOk = checkPackedContents(tarballs);
  if (!checkPackedSizeBudgets(tarballs) || !contentsOk) {
    failed = true;
  } else {
    writeFixture(fixtureDir, tarballs);
    writeImportSmoke(
      fixtureDir,
      tarballs.map((tarball) => tarball.name)
    );
    run("pnpm", ["install", "--ignore-scripts", "--no-frozen-lockfile"], { cwd: fixtureDir, stdio: "inherit" });
    run("node", ["smoke.mjs"], { cwd: fixtureDir, stdio: "inherit" });
    if (tarballs.some((tarball) => tarball.name === "@capsule-sdk/cli")) {
      smokeCliBin(fixtureDir);
    }
    if (tarballs.some((tarball) => tarball.name === "@capsule-sdk/bridge-worker")) {
      await smokeBridgeWorkerBin(fixtureDir);
    }
    console.log(`Package pack smoke passed for ${tarballs.length} packages in ${basename(tempRoot)}.`);
  }
} finally {
  if (process.env.CAPSULE_KEEP_PACK_SMOKE !== "1") {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept package pack smoke fixture at ${tempRoot}`);
  }
}

if (failed) {
  process.exit(1);
}
