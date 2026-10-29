import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const runner = join(import.meta.dirname, "..", "benchmarks", "run-gates.mjs");

// A checkout whose source has a broken change that was never built: dist/ still holds the earlier,
// working build, and the test reads dist/, as a test that resolves a workspace package through its
// package exports does. CI runs `pnpm test` on a fresh checkout before `pnpm build`, so there it fails.
function staleDistCheckout() {
  const root = mkdtempSync(join(tmpdir(), "capsule-gates-"));
  const scripts = { "clean:build": "node clean.mjs", test: "node check.mjs" };
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "gates-fixture", private: true, type: "module", scripts }, null, 2)}\n`);
  writeFileSync(join(root, "clean.mjs"), 'import { rmSync } from "node:fs";\nrmSync("dist", { recursive: true, force: true });\n');
  writeFileSync(
    join(root, "check.mjs"),
    'const { value } = await import("./dist/value.js");\nif (value !== "ok") {\n  console.error(`expected ok, got ${value}`);\n  process.exit(1);\n}\n'
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "value.js"), 'export const value = "broken";\n');
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
    assert.equal(result.status, 0, result.stderr);
    const statuses = result.stderr.trim().split("\n");
    assert.deepEqual(
      statuses.map((line) => line.replace(/ \([\d.]+s\)$/, "")),
      ["FAIL(exit=1) test"]
    );
    assert.match(result.stdout, /\$ pnpm clean:build && pnpm test/);
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
