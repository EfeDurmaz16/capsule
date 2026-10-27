// Loads the built workspace packages (packages/*/dist). Run `pnpm build` before benchmarking so the
// harness measures the same artifacts that are packed and published.
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// CAPSULE_BENCH_PACKAGES_ROOT points the same workloads at another build of packages/ (for example the
// pre-campaign anchor in benchmarks/ab.mjs). Unset, the harness measures this checkout's packages.
// The root is resolved with realpath: a CLI started through a symlinked path (macOS /tmp is one) did not
// run its command before c09b0c0, and the anchor still has that check.
const packagesRoot = process.env.CAPSULE_BENCH_PACKAGES_ROOT
  ? pathToFileURL(`${realpathSync(process.env.CAPSULE_BENCH_PACKAGES_ROOT)}/`)
  : new URL("../../packages/", import.meta.url);

export function packageDir(name) {
  return fileURLToPath(new URL(`${name}/`, packagesRoot));
}

export async function loadPackage(name) {
  const entry = new URL(`${name}/dist/index.js`, packagesRoot);
  if (!existsSync(entry)) {
    throw new Error(`Missing ${fileURLToPath(entry)}. Run \`pnpm build\` before benchmarks.`);
  }
  return await import(entry.href);
}

// Resolve a dependency exactly as the named workspace package resolves it, so prototype probes
// observe the same module instance the adapter uses.
export function requireFromPackage(name, specifier) {
  return createRequire(new URL(`${name}/package.json`, packagesRoot))(specifier);
}

export function cliEntry() {
  return fileURLToPath(new URL("cli/dist/index.js", packagesRoot));
}
