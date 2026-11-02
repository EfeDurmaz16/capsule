// The checks the bridge worker artifact build and smoke rely on. The artifact itself is built and run
// by the CI job bridge-artifact (pnpm bridge:sea, pnpm bridge:artifact-smoke); these keep the guards
// around it honest without building a 100 MB binary in every test run.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparable, isNativeExecutable, runtimesOnPath } from "./bridge-artifact-smoke.mjs";
import { supportsBuildSea, withoutHashbang } from "./build-bridge-worker-sea.mjs";

test("BRIDGE-ARTIFACT: --build-sea is required, which arrived in Node 25.5.0", () => {
  for (const version of ["v22.23.2", "v24.19.0", "v25.4.9", "v24.99.0"]) assert.equal(supportsBuildSea(version), false, version);
  for (const version of ["v25.5.0", "v25.9.1", "v26.0.0", "v26.13.0", "v27.0.0"]) assert.equal(supportsBuildSea(version), true, version);
});

test("BRIDGE-ARTIFACT: the build refuses a Node without --build-sea before bundling anything", { skip: supportsBuildSea(process.version) }, () => {
  const run = spawnSync(process.execPath, [join(import.meta.dirname, "build-bridge-worker-sea.mjs"), "--out", join(tmpdir(), "never-written")], {
    encoding: "utf8"
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /has no --build-sea; run this script with Node 25\.5\.0 or later/);
});

test("BRIDGE-ARTIFACT: the SEA main script loses only a leading hashbang line", () => {
  assert.equal(withoutHashbang("#!/usr/bin/env node\n'use strict';\nrun();\n"), "'use strict';\nrun();\n");
  assert.equal(withoutHashbang("'use strict';\n// #!/not/a/hashbang\n"), "'use strict';\n// #!/not/a/hashbang\n");
});

test("BRIDGE-ARTIFACT: only a native executable passes for the artifact, never a runtime script", () => {
  assert.equal(isNativeExecutable(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])), true, "ELF");
  assert.equal(isNativeExecutable(Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1])), true, "Mach-O 64 little endian");
  assert.equal(isNativeExecutable(Buffer.from("#!/usr/bin/env node\nimport './x.js';\n")), false, "script");
  assert.equal(isNativeExecutable(Buffer.from([0x7f])), false, "short");
});

test("BRIDGE-ARTIFACT: the smoke PATH check finds a runtime placed on it, and none on an empty directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "capsule-artifact-path-"));
  try {
    const empty = join(dir, "empty");
    const withNode = join(dir, "with-node");
    for (const path of [empty, withNode]) spawnSync("mkdir", [path]);
    writeFileSync(join(withNode, "node"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(withNode, "node"), 0o755);
    assert.deepEqual(runtimesOnPath(empty), []);
    assert.deepEqual(runtimesOnPath(withNode), [join(withNode, "node")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BRIDGE-ARTIFACT: scenario comparison ignores message strings and arrival time only", () => {
  const answer = {
    type: "error",
    request_id: "r-1",
    operation_id: "X",
    error: { code: "denied", reason: "policy_denied", message: "denied", effect: "none" },
    receivedAtMs: 3
  };
  assert.deepEqual(comparable(answer), {
    type: "error",
    request_id: "r-1",
    operation_id: "X",
    error: { code: "denied", reason: "policy_denied", effect: "none" }
  });
  assert.deepEqual(comparable({ type: "protocol_error", code: "oversize", message: "too big" }), { type: "protocol_error", code: "oversize" });
  assert.deepEqual(comparable({ type: "result", state: "completed", receivedAtMs: 1 }), { type: "result", state: "completed" });
});
