// The Docker smoke may skip on a workstation without an engine or image, but a required run (CI) must
// fail instead: a skipped physical proof is not a pass.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const smoke = join(import.meta.dirname, "bridge-docker-smoke.mjs");
// An engine address nothing listens on: docker version fails at once, so the smoke reaches its skip.
const unreachable = { ...process.env, DOCKER_HOST: "unix:///nonexistent/capsule-smoke.sock", DOCKER_CONTEXT: "" };

test("BRIDGE-DOCKER-SMOKE: an unreachable engine is a skip that exits 0 by default", () => {
  const run = spawnSync(process.execPath, [smoke], { env: unreachable, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).outcome, "skipped");
});

test("BRIDGE-DOCKER-SMOKE: with --require the same skip fails the run", () => {
  const run = spawnSync(process.execPath, [smoke, "--require"], { env: unreachable, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(JSON.parse(run.stdout).outcome, "skipped");
});
