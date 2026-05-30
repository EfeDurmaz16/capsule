import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createLiveCleanupSweep } from "./live-cleanup-sweep.mjs";

const root = join(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "live-cleanup-sweep.mjs");

function response(body, status = 200) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("live cleanup sweep dry-runs stale Fly machines without leaking secrets", async () => {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    return response([
      {
        id: "machine-stale",
        name: "capsule-live-fly-machine-old",
        config: { metadata: { capsule_live_test: "true", capsule_expires_at: "1780140000", capsule_owner: "efe" } }
      },
      {
        id: "machine-active",
        name: "capsule-live-fly-machine-new",
        config: { metadata: { capsule_live_test: "true", capsule_expires_at: "1780149999" } }
      },
      {
        id: "machine-other",
        name: "not-capsule",
        config: { metadata: { capsule_live_test: "false" } }
      }
    ]);
  };

  const report = await createLiveCleanupSweep({
    dryRun: true,
    provider: "fly",
    now: new Date("2026-05-30T12:00:00.000Z"),
    env: { FLY_API_TOKEN: "secret-fly-token", FLY_APP_NAME: "capsule-app" },
    fetch: fetchMock
  });

  assert.equal(report.summary.candidates, 2);
  assert.equal(report.summary.stale, 1);
  assert.equal(report.summary.deleted, 0);
  assert.deepEqual(
    report.providers[0]?.resources.map((resource) => ({ id: resource.id, stale: resource.stale, action: resource.action })),
    [
      { id: "machine-stale", stale: true, action: "would-delete" },
      { id: "machine-active", stale: false, action: "skip-active" }
    ]
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.machines.dev/v1/apps/capsule-app/machines?metadata.capsule_live_test=true");
  assert.equal(JSON.stringify(report).includes("secret-fly-token"), false);
});

test("live cleanup sweep deletes stale Fly machines only with explicit acknowledgement", async () => {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    if ((init.method ?? "GET") === "DELETE") return response(undefined);
    return response([
      {
        id: "machine-stale",
        name: "capsule-live-fly-machine-old",
        config: { metadata: { capsule_live_test: "true", capsule_expires_at: "1780140000" } }
      }
    ]);
  };

  const blocked = await createLiveCleanupSweep({
    delete: true,
    yes: true,
    provider: "fly",
    now: new Date("2026-05-30T12:00:00.000Z"),
    env: { FLY_API_TOKEN: "secret-fly-token", FLY_APP_NAME: "capsule-app" },
    fetch: fetchMock
  });

  assert.equal(blocked.providers[0]?.status, "blocked");
  assert.deepEqual(blocked.providers[0]?.missingEnv, ["CAPSULE_LIVE_CLEANUP_ACK"]);
  assert.equal(calls.length, 0);

  const report = await createLiveCleanupSweep({
    delete: true,
    yes: true,
    provider: "fly",
    now: new Date("2026-05-30T12:00:00.000Z"),
    env: { FLY_API_TOKEN: "secret-fly-token", FLY_APP_NAME: "capsule-app", CAPSULE_LIVE_CLEANUP_ACK: "1" },
    fetch: fetchMock
  });

  assert.equal(report.summary.deleted, 1);
  assert.equal(report.providers[0]?.resources[0]?.action, "deleted");
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["GET", "https://api.machines.dev/v1/apps/capsule-app/machines?metadata.capsule_live_test=true"],
    ["DELETE", "https://api.machines.dev/v1/apps/capsule-app/machines/machine-stale?force=true"]
  ]);
});

test("live cleanup sweep marks receipt-only providers unsupported", async () => {
  const report = await createLiveCleanupSweep({ dryRun: true, provider: "neon", env: {} });

  assert.equal(report.providers[0]?.provider, "neon");
  assert.equal(report.providers[0]?.status, "unsupported");
  assert.match(report.providers[0]?.notes.join(" "), /no provider-side Capsule cleanup tag/);
});

test("live cleanup sweep dry-runs stale Azure Container Apps resources", async () => {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    if (String(url).includes("/containerApps?")) {
      return response({
        value: [
          {
            id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/app-stale",
            name: "app-stale",
            tags: { capsule_live_test: "true", capsule_expires_at: "1780140000" }
          }
        ]
      });
    }
    return response({
      value: [
        {
          id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/job-active",
          name: "job-active",
          tags: { capsule_live_test: "true", capsule_expires_at: "1780149999" }
        }
      ]
    });
  };

  const report = await createLiveCleanupSweep({
    dryRun: true,
    provider: "azure-container-apps",
    now: new Date("2026-05-30T12:00:00.000Z"),
    env: {
      AZURE_ACCESS_TOKEN: "secret-azure-token",
      AZURE_SUBSCRIPTION_ID: "sub-1",
      AZURE_RESOURCE_GROUP: "rg-1"
    },
    fetch: fetchMock
  });

  assert.deepEqual(
    report.providers[0]?.resources.map((resource) => ({ type: resource.type, id: resource.id, stale: resource.stale, action: resource.action })),
    [
      {
        type: "containerApp",
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/containerApps/app-stale",
        stale: true,
        action: "would-delete"
      },
      {
        type: "job",
        id: "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.App/jobs/job-active",
        stale: false,
        action: "skip-active"
      }
    ]
  );
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(report).includes("secret-azure-token"), false);
});

test("live cleanup sweep deletes stale Kubernetes resources through kubectl only when acknowledged", async () => {
  const calls = [];
  const execFileMock = async (cmd, args) => {
    calls.push([cmd, args]);
    if (args[0] === "get") {
      return {
        stdout: JSON.stringify({
          items: [
            {
              kind: "Job",
              metadata: {
                uid: "job-uid",
                name: "capsule-live-k8s-job",
                labels: { capsule_live_test: "true", capsule_expires_at: "1780140000" }
              }
            }
          ]
        })
      };
    }
    return { stdout: "" };
  };

  const report = await createLiveCleanupSweep({
    delete: true,
    yes: true,
    provider: "kubernetes",
    now: new Date("2026-05-30T12:00:00.000Z"),
    env: { CAPSULE_KUBERNETES_NAMESPACE: "capsule-live", CAPSULE_LIVE_CLEANUP_ACK: "1", KUBECONFIG_CONTEXT: "dev" },
    execFile: execFileMock
  });

  assert.equal(report.summary.deleted, 1);
  assert.deepEqual(calls, [
    ["kubectl", ["get", "jobs,deployments,services", "-n", "capsule-live", "-l", "capsule_live_test=true", "-o", "json", "--context", "dev"]],
    ["kubectl", ["delete", "job", "capsule-live-k8s-job", "-n", "capsule-live", "--wait=false", "--context", "dev"]]
  ]);
});

test("live cleanup sweep dry-run command emits JSON and exits without credentials", () => {
  const stdout = execFileSync(process.execPath, [scriptPath, "--dry-run", "--provider", "fly"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" }
  });
  const report = JSON.parse(stdout);

  assert.equal(report.dryRun, true);
  assert.equal(report.providers[0]?.provider, "fly");
  assert.equal(report.providers[0]?.status, "blocked");
  assert.deepEqual(report.providers[0]?.missingEnv, ["FLY_API_TOKEN", "FLY_APP_NAME"]);
});
