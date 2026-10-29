#!/usr/bin/env node
// Runs every repository gate defined in package.json and .github/workflows/ci.yml in CI order
// and writes a plain-text record (command, exit code, duration, output tail) for baseline evidence.
// Usage: node benchmarks/run-gates.mjs [--root <checkout>] [--only <gate>,<gate>] --out benchmarks/baseline/gates-<sha>.txt
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex > 0 ? resolve(process.argv[rootIndex + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outIndex = process.argv.indexOf("--out");
const out = outIndex > 0 ? resolve(process.argv[outIndex + 1]) : undefined;
const tailLines = 25;

const gates = [
  ["install", "pnpm install --frozen-lockfile"],
  ["provider-matrix-check", "pnpm capsule:gap:check"],
  ["format", "pnpm format:check"],
  ["typecheck", "pnpm typecheck"],
  // CI runs the tests on a fresh checkout, before any build. A local checkout keeps the dist/ of an
  // earlier build, which can let a test that reads dist/ pass against code the source no longer has, so
  // the test gate removes build output first. Gates that need dist/ run after the build gate, as in CI.
  ["test", "pnpm clean:build && pnpm test"],
  ["build", "pnpm build"],
  ["release-audit", "pnpm release:audit"],
  ["api-reference-current", "pnpm docs:api:check"],
  ["package-exports", "pnpm test:package-exports"],
  ["pack-smoke-compatible", "pnpm release:pack-smoke:compatible"],
  ["benchmark-bounds", "pnpm bench:bounds"]
];

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > 0 ? (process.argv[onlyIndex + 1] ?? "").split(",").filter(Boolean) : undefined;
for (const name of only ?? []) {
  if (!gates.some(([gate]) => gate === name)) {
    process.stderr.write(`unknown gate "${name}"; gates: ${gates.map(([gate]) => gate).join(", ")}\n`);
    process.exit(2);
  }
}
const selected = only ? gates.filter(([name]) => only.includes(name)) : gates;

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.stdout.trim();
}

const lines = [];
lines.push(`# Capsule gate record`);
lines.push(`commit: ${git(["rev-parse", "HEAD"])}`);
lines.push(`date: ${new Date().toISOString()}`);
lines.push(
  `host: ${os.platform()} ${os.release()} ${os.arch()}, cpus=${os.cpus().length} (${os.cpus()[0]?.model ?? "unknown"}), mem=${Math.round(os.totalmem() / 2 ** 30)}GiB`
);
lines.push(`node: ${process.version}`);
lines.push(`pnpm: ${spawnSync("pnpm", ["-v"], { cwd: root, encoding: "utf8" }).stdout.trim()}`);
lines.push(
  only
    ? `gates: only ${selected.map(([name]) => name).join(", ")}, in CI order`
    : `gates: same commands as the .github/workflows/ci.yml jobs (verify, Node compatibility, benchmark bounds), run locally in order`
);
lines.push("");

const summary = [];
for (const [name, command] of selected) {
  const started = performance.now();
  const r = spawnSync("bash", ["-lc", command], { cwd: root, encoding: "utf8", maxBuffer: 256 * 2 ** 20, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  const all = combined.trimEnd().split("\n");
  const tail = all.slice(-tailLines);
  const counts = all.filter((l) => /^\s*(Test Files|Tests|Duration)\s|^\s*(#|ℹ) (tests|pass|fail|skipped|todo) /.test(l)).map((l) => l.trim());
  const status = r.status === 0 ? "PASS" : `FAIL(exit=${r.status ?? r.signal})`;
  summary.push(`${status.padEnd(14)} ${name.padEnd(24)} ${seconds}s  $ ${command}${counts.length > 0 ? `  [${counts.join(" | ")}]` : ""}`);
  lines.push(`## ${name}: ${status} in ${seconds}s`);
  lines.push(`$ ${command}`);
  if (counts.length > 0) lines.push(`counts: ${counts.join(" | ")}`);
  lines.push(...tail.map((l) => `  ${l}`));
  lines.push("");
  process.stderr.write(`${status} ${name} (${seconds}s)\n`);
}

const text = [lines[0], ...lines.slice(1, 8), "## summary", ...summary, "", ...lines.slice(8)].join("\n") + "\n";
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
} else {
  process.stdout.write(text);
}
