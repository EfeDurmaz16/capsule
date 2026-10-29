#!/usr/bin/env node
// Builds capsule-bridge-worker as one executable that needs no Node, Bun or pnpm on the host: a Node
// single executable application (SEA) holding the bundled worker.
//
//   pnpm build && pnpm bridge:sea [--out <path>]
//
// It bundles packages/bridge-worker/dist/bin.js, the code the npm package ships, with every workspace
// dependency into one CommonJS file (tsup, already a dev dependency), then runs `node --build-sea`,
// which copies the running Node binary and injects the bundle into it. --build-sea arrived in Node
// 25.5.0 and is in Node 26 LTS; on Node 22 and 24 a SEA needs --experimental-sea-config plus a separate
// injector such as postject, a dependency this repository does not take. So this script needs Node
// 25.5 or later to run, and the artifact embeds that Node. On macOS the binary is signed ad hoc, as
// arm64 macOS refuses to run an unsigned one. A cross-built artifact is not supported: build it on the
// platform it runs on, and prove it there with scripts/bridge-artifact-smoke.mjs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerRoot = join(repoRoot, "packages", "bridge-worker");

/** The first Node release with `--build-sea`. */
export const MIN_BUILD_SEA = [25, 5, 0];

export function supportsBuildSea(version) {
  const [major, minor, patch] = version.replace(/^v/, "").split(".").map(Number);
  const [wantMajor, wantMinor, wantPatch] = MIN_BUILD_SEA;
  if (major !== wantMajor) return major > wantMajor;
  if (minor !== wantMinor) return minor > wantMinor;
  return patch >= wantPatch;
}

/** A bundle's leading hashbang line, which a SEA main script must not carry. */
export function withoutHashbang(source) {
  return source.startsWith("#!") ? source.slice(source.indexOf("\n") + 1) : source;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const out = resolve(values.out ?? join(workerRoot, "sea", process.platform === "win32" ? "capsule-bridge-worker.exe" : "capsule-bridge-worker"));
  if (!supportsBuildSea(process.version)) {
    throw new Error(`node ${process.version} has no --build-sea; run this script with Node 25.5.0 or later (Node 26 LTS)`);
  }
  const entry = join(workerRoot, "dist", "bin.js");
  try {
    statSync(entry);
  } catch {
    throw new Error(`${entry} is missing; run pnpm build first`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "capsule-bridge-sea-"));
  try {
    const { build } = await import("tsup");
    await build({
      config: false,
      entry: { "capsule-bridge-worker": entry },
      outDir: scratch,
      format: ["cjs"],
      platform: "node",
      target: "node22",
      // Bundle every dependency, workspace packages included; only Node built-ins stay outside.
      noExternal: [/.*/],
      splitting: false,
      sourcemap: false,
      dts: false,
      minify: false,
      clean: false,
      silent: true
    });
    const bundle = join(scratch, "capsule-bridge-worker.cjs");
    writeFileSync(bundle, withoutHashbang(readFileSync(bundle, "utf8")));
    const config = join(scratch, "sea-config.json");
    mkdirSync(dirname(out), { recursive: true });
    rmSync(out, { force: true });
    writeFileSync(config, JSON.stringify({ main: bundle, output: out, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2));
    // Their progress lines go to stderr, so stdout carries only this script's JSON report.
    execFileSync(process.execPath, ["--build-sea", config], { stdio: ["ignore", 2, 2] });
    if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", "--force", out], { stdio: ["ignore", 2, 2] });
    chmodSync(out, 0o755);
    const bytes = readFileSync(out);
    const report = {
      artifact: out,
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bundleBytes: statSync(bundle).size
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`build-bridge-worker-sea: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
