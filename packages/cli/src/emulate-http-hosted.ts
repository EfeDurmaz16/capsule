import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureJson, runProviderHttpFixture, type ProviderHttpOutcome, type ProviderHttpRequest } from "./emulate-http-fixture.js";

const token = "capsule-local-fixture";
const project = "capsule-example";
const moduleName = "index.js";
const moduleText = 'export default { fetch() { return new Response("capsule"); } };';

async function withModule(exercise: (path: string) => Promise<ProviderHttpOutcome>): Promise<ProviderHttpOutcome> {
  const dir = await mkdtemp(join(tmpdir(), "capsule-http-"));
  try {
    const path = join(dir, moduleName);
    await writeFile(path, moduleText);
    return await exercise(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function checkAuth(request: ProviderHttpRequest): void {
  assert.equal(request.headers.authorization, `Bearer ${token}`);
}

function vercelDeployment() {
  const id = "dpl_capsuleFixture";
  const deployment = { id, name: project, url: "capsule-example.invalid" };
  let created = false;
  return runProviderHttpFixture({
    provider: "vercel",
    adapter: async (origin) => (await import("@capsule-sdk/vercel")).vercel({ baseUrl: origin, token, project, target: "production" }),
    handle(request) {
      checkAuth(request);
      if (request.method === "POST" && request.url.pathname === "/v13/deployments") {
        assert.equal(created, false);
        assert.deepEqual(JSON.parse(request.body.toString()), {
          project,
          name: project,
          target: "production",
          files: [{ file: moduleName, data: moduleText, encoding: "utf-8" }],
          meta: { capsule: "true" }
        });
        created = true;
        return fixtureJson(200, { ...deployment, readyState: "BUILDING" });
      }
      if (created && request.method === "GET" && request.url.pathname === `/v13/deployments/${id}`) {
        return fixtureJson(200, { ...deployment, readyState: "READY" });
      }
    },
    exercise: (capsule) =>
      withModule(async (path) => {
        const submitted = await capsule.edge.deploy({ name: project, source: { path } });
        assert.equal(submitted.id, id);
        assert.equal(submitted.status, "deploying");
        const observed = await capsule.edge.status({ id: submitted.id });
        assert.equal(observed.id, id);
        assert.equal(observed.status, "ready");
        assert.equal(observed.url, `https://${deployment.url}`);
        return {
          result: { resourceId: observed.id, status: observed.status },
          cleanup: "no-retained-emulator-state",
          assertions: ["Vercel received the inline source file.", "A status read for the same deployment advanced from deploying to ready."]
        };
      })
  });
}

function neonBranch() {
  const id = "br-capsule-fixture";
  const parent = "br-parent";
  const branches = `/api/v2/projects/${project}/branches`;
  let exists = false;
  return runProviderHttpFixture({
    provider: "neon",
    adapter: async (origin) => (await import("@capsule-sdk/neon")).neon({ baseUrl: origin + "/api/v2", apiKey: token, createEndpoint: false }),
    handle(request) {
      checkAuth(request);
      if (request.method === "POST" && request.url.pathname === branches) {
        assert.equal(exists, false);
        assert.deepEqual(JSON.parse(request.body.toString()), { branch: { name: project, parent_id: parent } });
        exists = true;
        return fixtureJson(201, { branch: { id, name: project, parent_id: parent, current_state: "ready" }, operations: [] });
      }
      if (exists && request.method === "DELETE" && request.url.pathname === `${branches}/${id}`) {
        assert.equal(request.url.searchParams.get("hard_delete"), "true");
        exists = false;
        return fixtureJson(200, { branch: { id, name: project }, operations: [] });
      }
    },
    async exercise(capsule) {
      const branch = await capsule.database.branch.create({ project, parent, name: project });
      assert.equal(branch.id, id);
      assert.equal(branch.parent, parent);
      assert.equal(branch.status, "ready");
      const deleted = await capsule.database.branch.delete({ project, branchId: branch.id, hardDelete: true });
      assert.equal(deleted.id, id);
      assert.equal(deleted.status, "deleted");
      assert.equal(exists, false);
      return {
        result: { resourceId: deleted.id, status: deleted.status },
        cleanup: "emulator-destroyed",
        assertions: ["Neon received the specified parent branch.", "Hard deletion removed the returned ID from the emulator."]
      };
    }
  });
}

function cloudflareModule() {
  const account = "00000000000000000000000000000001";
  const date = "2025-01-01";
  const script = "capsule-worker";
  return runProviderHttpFixture({
    provider: "cloudflare",
    adapter: async (origin) =>
      (await import("@capsule-sdk/cloudflare")).cloudflare({
        baseUrl: origin + "/client/v4",
        apiToken: token,
        accountId: account,
        zoneId: "fixture",
        compatibilityDate: date
      }),
    async handle(request) {
      checkAuth(request);
      if (request.method !== "PUT" || request.url.pathname !== `/client/v4/accounts/${account}/workers/scripts/${script}`) return;
      const contentType = request.headers["content-type"] ?? "";
      assert.match(contentType, /^multipart\/form-data;\s*boundary=/i);
      const form = await new Response(new Uint8Array(request.body), { headers: { "content-type": contentType } }).formData();
      const metadata = form.get("metadata");
      assert.equal(typeof metadata, "string");
      assert.deepEqual(JSON.parse(String(metadata)), { main_module: moduleName, compatibility_date: date, bindings: [] });
      const file = form.get(moduleName);
      assert.ok(file && typeof file !== "string");
      assert.equal(file.name, moduleName);
      assert.equal(file.type, "application/javascript+module");
      assert.equal(await file.text(), moduleText);
      return fixtureJson(200, { result: { id: script, entry_point: moduleName, compatibility_date: date }, success: true, errors: [], messages: [] });
    },
    exercise: (capsule) =>
      withModule(async (path) => {
        const deployment = await capsule.edge.deploy({ name: script, runtime: "workers", source: { path, entrypoint: moduleName } });
        assert.equal(deployment.id, script);
        assert.equal(deployment.status, "ready");
        return {
          result: { resourceId: deployment.id, status: deployment.status },
          cleanup: "no-retained-emulator-state",
          assertions: ["Cloudflare received the Worker module bytes and matching multipart metadata.", "The adapter decoded the Workers API success envelope."]
        };
      })
  });
}

function flyMachine() {
  const id = "d8912345678900";
  const region = "ams";
  const image = "alpine:3.21";
  const machines = `/v1/apps/${project}/machines`;
  const machine = { id, name: project, region };
  let exists = false;
  return runProviderHttpFixture({
    provider: "fly",
    adapter: async (origin) => (await import("@capsule-sdk/fly")).fly({ baseUrl: origin, apiToken: token, appName: project, region }),
    handle(request) {
      checkAuth(request);
      if (request.method === "POST" && request.url.pathname === machines) {
        assert.equal(exists, false);
        assert.deepEqual(JSON.parse(request.body.toString()), {
          name: project,
          region,
          config: { image, guest: { cpu_kind: "shared" } }
        });
        exists = true;
        return fixtureJson(200, { ...machine, state: "created" });
      }
      if (exists && request.url.pathname === `${machines}/${id}`) {
        if (request.method === "GET") return fixtureJson(200, { ...machine, state: "started" });
        if (request.method === "DELETE") {
          assert.equal(request.url.searchParams.get("force"), "true");
          exists = false;
          return fixtureJson(200, { ok: true });
        }
      }
    },
    async exercise(capsule) {
      const created = await capsule.machine.create({ name: project, image });
      assert.equal(created.id, id);
      assert.equal(created.status, "creating");
      const observed = await capsule.machine.status({ id: created.id });
      assert.equal(observed.status, "running");
      const deleted = await capsule.machine.destroy({ id: created.id, force: true });
      assert.equal(deleted.id, id);
      assert.equal(deleted.status, "deleted");
      assert.equal(exists, false);
      return {
        result: { resourceId: deleted.id, status: deleted.status },
        cleanup: "emulator-destroyed",
        assertions: ["Fly received the requested region and machine image.", "Machine status mapped to running and deletion removed the same ID."]
      };
    }
  });
}

export type HostedHttpProvider = "vercel" | "neon" | "cloudflare" | "fly";

export function runHostedProviderHttp(provider: HostedHttpProvider) {
  switch (provider) {
    case "vercel":
      return vercelDeployment();
    case "neon":
      return neonBranch();
    case "cloudflare":
      return cloudflareModule();
    case "fly":
      return flyMachine();
  }
}
