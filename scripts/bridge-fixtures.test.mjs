// The bridge protocol v1 fixtures in protocol/bridge/v1 are a byte-identical copy of Fabric's
// protocol/bridge/v1, the source of truth (Fabric docs/bridge-protocol.md, ADR 0021). This test checks
// every file against manifest.sha256, that no file is missing or extra, and that the manifest itself
// is the pinned one. Fabric's crates/fabric-client/tests/bridge_fixtures.rs pins the same digest, so a
// fixture change lands in both repositories or fails in one.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const MANIFEST_SHA256 = "347f507eeb2cae5d4fdc87dff54a8869cbc9af873c0069ca66cbf152ffa755bf";

const root = join(import.meta.dirname, "..", "protocol", "bridge", "v1");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [relative(root, path).split(sep).join("/")];
  });
}

function manifest() {
  const lines = readFileSync(join(root, "manifest.sha256"), "utf8").split("\n");
  assert.equal(lines.pop(), "", "manifest ends with one newline");
  const entries = new Map();
  let previous = "";
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    assert.ok(match, `manifest line: ${line}`);
    assert.ok(previous < match[2], `manifest not sorted at ${match[2]}`);
    previous = match[2];
    entries.set(match[2], match[1]);
  }
  return entries;
}

test("BRIDGE-01: the bridge fixture manifest is the one Fabric pins", () => {
  assert.equal(sha256(readFileSync(join(root, "manifest.sha256"))), MANIFEST_SHA256);
});

test("BRIDGE-01: every bridge fixture matches the manifest and none is missing or extra", () => {
  const listed = manifest();
  const found = files(root)
    .filter((path) => path !== "manifest.sha256")
    .sort();
  assert.deepEqual(found, [...listed.keys()]);
  for (const [path, digest] of listed) {
    const bytes = readFileSync(join(root, path));
    assert.equal(sha256(bytes), digest, `${path} does not match the manifest`);
    assert.ok(!bytes.includes(0x0d), `${path} has a carriage return; fixtures are LF only`);
  }
});

test("BRIDGE-01: framed fixtures use the inherited 1 MiB and 16 MiB caps", () => {
  const caps = { handshake: 1 << 20, fabric_to_worker: 1 << 20, worker_to_fabric: 16 << 20 };
  for (const name of readdirSync(join(root, "frames"))) {
    const fixture = JSON.parse(readFileSync(join(root, "frames", name), "utf8"));
    const bytes = Buffer.from(fixture.hex, "hex");
    const cap = fixture.phase === "handshake" ? caps.handshake : caps[fixture.direction];
    if (fixture.expect.outcome === "accept") {
      const declared = bytes.readUInt32LE(0);
      assert.equal(declared, bytes.length - 4, `${name}: length prefix`);
      assert.ok(declared > 0 && declared <= cap, `${name}: within the cap`);
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4)));
      assert.equal(body.type, fixture.expect.type, `${name}: message type`);
      const kase = JSON.parse(readFileSync(join(root, "cases", `${fixture.case}.json`), "utf8"));
      assert.deepEqual(body, kase.message, `${name}: frame and case differ`);
    } else if (fixture.expect.code === "oversize") {
      assert.ok(bytes.readUInt32LE(0) > cap && fixture.expect.read_body === false, name);
    }
  }
});
