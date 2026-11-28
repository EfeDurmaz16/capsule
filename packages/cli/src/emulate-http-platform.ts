import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { azureContainerApps } from "@capsule-sdk/azure";
import { cloudRun } from "@capsule-sdk/cloud-run";
import type { Capsule } from "@capsule-sdk/core";
import { gce } from "@capsule-sdk/gce";
import { kubernetes } from "@capsule-sdk/kubernetes";
import { fixtureJson, runProviderHttpFixture, type ProviderHttpRequest } from "./emulate-http-fixture.js";

const name = "capsule-example";
const token = "capsule-emulator-token";
const project = "capsule-emulator";
const region = "us-central1";
const namespace = "capsule";
const subscription = "00000000-0000-4000-8000-000000000001";
const azureId = `/subscriptions/${subscription}/resourceGroups/${namespace}/providers/Microsoft.App/containerApps/${name}`;

function checkRead(request: ProviderHttpRequest, path: string, search = "") {
  assert.equal(request.method, "GET");
  assert.equal(request.url.pathname, path);
  assert.equal(request.url.search, search);
  assert.equal(request.headers.authorization, `Bearer ${token}`);
  assert.equal(request.body.length, 0);
}

async function readService(capsule: Capsule, id = name) {
  const result = await capsule.service.status({ id });
  assert.equal(result.id, id);
  assert.equal(result.status, "ready");
  return {
    result: { resourceId: result.id, status: result.status },
    cleanup: "no-retained-emulator-state" as const,
    assertions: ["authenticated service read on loopback", "provider service state maps to ready"]
  };
}

async function runKubernetesHttp() {
  const directory = await mkdtemp(join(tmpdir(), "capsule-kubeconfig-"));
  const kubeconfigPath = join(directory, "config");
  try {
    return await runProviderHttpFixture({
      provider: "kubernetes",
      async adapter(origin) {
        const kubeconfig = {
          apiVersion: "v1",
          kind: "Config",
          clusters: [{ name: "local", cluster: { server: origin, "insecure-skip-tls-verify": true } }],
          users: [{ name: "emulator", user: { token } }],
          contexts: [{ name: "local", context: { cluster: "local", user: "emulator", namespace } }],
          "current-context": "local"
        };
        await writeFile(kubeconfigPath, JSON.stringify(kubeconfig), { mode: 0o600 });
        return kubernetes({ kubeconfigPath, namespace });
      },
      handle(request) {
        const metadata = { name, namespace };
        const servicePath = `/api/v1/namespaces/${namespace}/services/${name}`;
        if (request.url.pathname === servicePath) {
          checkRead(request, servicePath);
          return fixtureJson(200, { apiVersion: "v1", kind: "Service", metadata, spec: { type: "ClusterIP" } });
        }
        checkRead(request, `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`);
        return fixtureJson(200, {
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata,
          spec: { replicas: 1 },
          status: { readyReplicas: 1, availableReplicas: 1 }
        });
      },
      exercise: readService
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function runPlatformProviderHttp(provider: "cloud-run" | "azure-container-apps" | "gce" | "kubernetes") {
  switch (provider) {
    case "kubernetes":
      return runKubernetesHttp();
    case "azure-container-apps":
      return runProviderHttpFixture({
        provider,
        adapter: (origin) => azureContainerApps({ subscriptionId: subscription, resourceGroupName: namespace, accessToken: token, baseUrl: origin }),
        handle(request) {
          checkRead(request, azureId, "?api-version=2025-07-01");
          return fixtureJson(200, { id: azureId, name, type: "Microsoft.App/containerApps", properties: { provisioningState: "Succeeded" } });
        },
        exercise: (capsule) => readService(capsule, azureId)
      });
    case "cloud-run": {
      const service = `projects/${project}/locations/${region}/services/${name}`;
      return runProviderHttpFixture({
        provider,
        adapter: (origin) =>
          cloudRun({ projectId: project, location: region, accessToken: token, baseUrl: `${origin}/v2`, loggingBaseUrl: `${origin}/logging/v2` }),
        handle(request) {
          checkRead(request, `/v2/${service}`);
          return fixtureJson(200, { name: service, terminalCondition: { type: "Ready", state: "CONDITION_SUCCEEDED" } });
        },
        exercise: readService
      });
    }
    case "gce": {
      const zone = `${region}-a`;
      return runProviderHttpFixture({
        provider,
        adapter: (origin) => gce({ projectId: project, zone, accessToken: () => token, baseUrl: `${origin}/compute/v1` }),
        handle(request) {
          checkRead(request, `/compute/v1/projects/${project}/zones/${zone}/instances/${name}`);
          return fixtureJson(200, { name, status: "RUNNING" });
        },
        async exercise(capsule) {
          const result = await capsule.machine.status({ id: name });
          assert.equal(result.id, name);
          assert.equal(result.status, "running");
          return {
            result: { resourceId: result.id, status: result.status },
            cleanup: "no-retained-emulator-state",
            assertions: ["authenticated zonal instance read on loopback", "RUNNING maps to running"]
          };
        }
      });
    }
  }
}
