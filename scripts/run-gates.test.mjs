import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const runner = join(import.meta.dirname, "..", "benchmarks", "run-gates.mjs");

// A checkout whose source has a broken change that was never built: dist/ still holds the earlier,
// working build, and the test reads dist/, as a test that resolves a workspace package through its
// package exports does. CI runs `pnpm test` on a fresh checkout before `pnpm build`, so there it fails.
// The gates that read dist/ run the same check; CI runs each of them after `pnpm build`.
function staleDistCheckout({ source = "broken", testReadsDist = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "capsule-gates-"));
  const scripts = {
    "clean:build": "node clean.mjs",
    build: "node build.mjs",
    test: testReadsDist ? "node check.mjs" : "node -e 0",
    "release:audit": "node check.mjs",
    "test:package-exports": "node check.mjs",
    "release:pack-smoke:compatible": "node check.mjs",
    "bench:bounds": "node check.mjs"
  };
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "gates-fixture", private: true, type: "module", scripts }, null, 2)}\n`);
  writeFileSync(join(root, "clean.mjs"), 'import { rmSync } from "node:fs";\nrmSync("dist", { recursive: true, force: true });\n');
  writeFileSync(
    join(root, "build.mjs"),
    'import { cpSync, rmSync } from "node:fs";\nrmSync("dist", { recursive: true, force: true });\ncpSync("src", "dist", { recursive: true });\n'
  );
  writeFileSync(
    join(root, "check.mjs"),
    'const { value } = await import("./dist/value.js");\nif (value !== "ok") {\n  console.error(`expected ok, got ${value}`);\n  process.exit(1);\n}\n'
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "value.js"), `export const value = "${source}";\n`);
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "value.js"), 'export const value = "ok";\n');
  return root;
}

test("the test gate cannot pass against a dist/ left by an earlier build", () => {
  const root = staleDistCheckout();
  try {
    // The fixture's own test run proves the stale build hides the broken change.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    assert.equal(spawnSync(process.execPath, ["check.mjs"], { cwd: root, env }).status, 0);

    const result = spawnSync(process.execPath, [runner, "--root", root, "--only", "test"], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
    // A failed gate is a failed run: the record is written, and the exit status says so.
    assert.equal(result.status, 1, result.stderr);
    const statuses = result.stderr
      .trim()
      .split("\n")
      .filter((line) => /^(PASS|FAIL)/.test(line));
    assert.deepEqual(
      statuses.map((line) => line.replace(/ \([\d.]+s\)$/, "")),
      ["FAIL(exit=1) test"]
    );
    assert.match(result.stderr, /1 of 1 gates failed/);
    assert.match(result.stdout, /\$ pnpm clean:build && pnpm test/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Runs the gate runner on a fixture and returns its exit status and the status line of each gate it
// ran, in order. `only` is passed as the --only value; an array passes several arguments.
function runGates(root, only) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const args = [runner, "--root", root, "--only", ...(Array.isArray(only) ? only : [only])];
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  const statuses = result.stderr
    .trim()
    .split("\n")
    .filter((line) => /^(PASS|FAIL)/.test(line))
    .map((line) => line.replace(/ \([\d.]+s\)$/, ""));
  return { status: result.status, statuses, stdout: result.stdout, stderr: result.stderr };
}

test("--only builds before a gate that reads dist/, so a stale dist/ cannot hide a broken change", () => {
  const root = staleDistCheckout();
  try {
    const bench = runGates(root, "benchmark-bounds");
    assert.deepEqual(bench.statuses, ["PASS build", "FAIL(exit=1) benchmark-bounds"]);
    assert.equal(bench.status, 1, bench.stderr);
    assert.match(bench.stdout, /gates: only build, benchmark-bounds, in CI order \(build added: benchmark-bounds reads dist\/\)/);

    const release = runGates(root, "release-audit,package-exports,pack-smoke-compatible");
    assert.deepEqual(release.statuses, ["PASS build", "FAIL(exit=1) release-audit", "FAIL(exit=1) package-exports", "FAIL(exit=1) pack-smoke-compatible"]);
    assert.equal(release.status, 1, release.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--only rebuilds after the test gate removes dist/, so a later gate does not fail for the wrong reason", () => {
  const root = staleDistCheckout({ source: "ok", testReadsDist: false });
  try {
    const run = runGates(root, "test,benchmark-bounds");
    assert.deepEqual(run.statuses, ["PASS test", "PASS build", "PASS benchmark-bounds"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /all 3 gates passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exits non-zero when a selected gate fails, after writing the record", () => {
  const root = staleDistCheckout({ source: "ok", testReadsDist: false });
  try {
    const out = join(root, "record", "gates.txt");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const args = [runner, "--root", root, "--only", "test,release-audit", "--out", out];
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
    // release-audit reads dist/ and runs after the build gate, so it passes; break it to fail one gate.
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(root, "check.mjs"), "process.exit(3);\n");
    const failing = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(failing.status, 1, failing.stderr);
    assert.match(failing.stderr, /1 of 3 gates failed/);
    assert.match(readFileSync(out, "utf8"), /FAIL\(exit=3\)\s+release-audit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// An empty selection would run no gate and report an all-clear.
test("--only rejects an empty selection", () => {
  const root = staleDistCheckout({ source: "ok", testReadsDist: false });
  try {
    for (const only of ["", ",", ["--out", join(root, "gates.txt")]]) {
      const result = runGates(root, only);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /--only needs at least one gate/);
      assert.deepEqual(result.statuses, []);
    }
    const result = spawnSync(process.execPath, [runner, "--root", root, "--only"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /--only needs at least one gate/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--only rejects a gate name the runner does not define", () => {
  const root = mkdtempSync(join(tmpdir(), "capsule-gates-"));
  try {
    const result = spawnSync(process.execPath, [runner, "--root", root, "--only", "tests"], { encoding: "utf8", timeout: 60_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown gate "tests"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
