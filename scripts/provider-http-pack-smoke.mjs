// Run from an external npm consumer with the packed CLI and its dependencies installed.
// The macOS sandbox applies to every descendant, including native provider clients.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const representativeRoutes = {
  "azure-container-apps": /^GET \/subscriptions\/.+\/providers\/Microsoft\.App\/containerApps\//i,
  "cloud-run": /^GET \/v2\/projects\/.+\/locations\/.+\/services\//,
  cloudflare: /^PUT \/client\/v4\/accounts\/.+\/workers\/scripts\//,
  daytona: /^POST \/api\/sandbox$/,
  docker: /^POST (?:\/v1\.\d+)?\/containers\/create$/,
  e2b: /^POST (?:\/v2)?\/sandboxes$/,
  ec2: /^POST \/$/,
  ecs: /^POST \/$/,
  fly: /^POST \/v1\/apps\/.+\/machines$/,
  gce: /^GET \/compute\/v1\/projects\/.+\/zones\/.+\/instances\//,
  kubernetes: /^GET \/api\/v1\/namespaces\/.+\/services\//,
  lambda: /^POST \/2015-03-31\/functions\/.+\/invocations$/,
  modal: /^POST \/modal\.client\.ModalClient\/SandboxCreate$/,
  neon: /^POST \/api\/v2\/projects\/.+\/branches$/,
  vercel: /^POST \/v13\/deployments$/
};
const consumer = resolve(process.argv[2] ?? ".");
const cli = realpathSync(join(consumer, "node_modules/.bin/capsule"));
const { verifyReceipt } = await import(pathToFileURL(join(consumer, "node_modules/@capsule-sdk/core/dist/index.js")));
const home = mkdtempSync(join(tmpdir(), "capsule-emulate-consumer-"));
const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: consumer,
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 90_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || `Unexpected exit ${result.status} (${result.signal})`);
  return result.stdout;
}

function report(...args) {
  return JSON.parse(run([cli, "emulate", ...args, "--json"]));
}

try {
  if (process.platform === "darwin" && process.argv[3] !== "--under-network-guard") {
    const result = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, process.argv[1], consumer, "--under-network-guard"], {
      stdio: "inherit",
      cwd: consumer,
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: home }
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, "Loopback-only consumer run failed");
  } else {
    // On Linux invoke inside a container with --network none, or a namespace with only lo.
    // TEST-NET-1 is reserved for documentation. A timeout is not proof of isolation.
    run([
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { connect } from "node:net";
      const socket = connect({ host: "192.0.2.1", port: 443 });
      socket.setTimeout(1000, () => socket.destroy(new Error("Network guard timed out")));
      socket.on("connect", () => { throw new Error("External route is available"); });
      socket.on("error", error => assert.ok(["EPERM", "EACCES", "ENETUNREACH"].includes(error.code), String(error)));
    `
    ]);
    const catalog = report("list").providers;
    assert.deepEqual(
      catalog.map((entry) => entry.provider),
      Object.keys(representativeRoutes)
    );
    for (const { provider, evidence, operations, providerHttpOperations } of catalog) {
      assert.equal(evidence["provider-http"], "available");
      const model = report("run", "--provider", provider);
      assert.equal(model.evidence, "model");
      assert.deepEqual(model.operations, operations);
      assert.equal(model.requests, undefined);
      assert.ok(["model-destroyed", "no-retained-model-state"].includes(model.cleanup));
      const http = report("run", "--provider", provider, "--mode", "provider-http");
      assert.equal(http.provider, provider);
      assert.equal(http.evidence, "provider-http");
      assert.ok(providerHttpOperations.length > 0);
      assert.deepEqual(http.operations, providerHttpOperations);
      assert.ok(http.requests.length > 0);
      for (const { method, path } of http.requests) {
        assert.match(method, /^[A-Z]+$/);
        assert.match(path, /^\/(?!\/)/);
      }
      const observed = http.requests.map(({ method, path }) => `${method} ${path}`);
      assert.ok(
        observed.some((route) => representativeRoutes[provider].test(route)),
        `${provider}: unexpected routes ${observed.join(", ")}`
      );
      assert.ok(["emulator-destroyed", "no-retained-emulator-state"].includes(http.cleanup));
      assert.deepEqual(
        http.receipts.map((receipt) => receipt.capabilityPath),
        providerHttpOperations
      );
      for (const receipt of http.receipts) {
        assert.equal(receipt.metadata.providerEvidence, "provider-http");
        assert.equal(receipt.supportLevel, "emulated");
        assert.ok(verifyReceipt(receipt).valid);
      }
      console.log(`${provider}: ${http.requests.length} local requests, ${http.receipts.length} verified receipts`);
    }
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}
