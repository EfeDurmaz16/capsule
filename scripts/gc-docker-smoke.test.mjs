// The gc Docker smoke may skip on a workstation without an engine or image, but a required run must fail.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const smoke = join(import.meta.dirname, "gc-docker-smoke.mjs");
const unreachable = { ...process.env, DOCKER_HOST: "unix:///nonexistent/capsule-gc-smoke.sock", DOCKER_CONTEXT: "" };

test("GC-DOCKER-SMOKE: an unreachable engine is a skip that exits 0 by default", () => {
  const run = spawnSync(process.execPath, [smoke], { env: unreachable, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).outcome, "skipped");
});

test("GC-DOCKER-SMOKE: with --require the same skip fails the run", () => {
  const run = spawnSync(process.execPath, [smoke, "--require"], { env: unreachable, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(JSON.parse(run.stdout).outcome, "skipped");
});
