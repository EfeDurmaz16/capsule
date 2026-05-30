#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { liveTestMatrixPlans } from "./live-test-matrix.mjs";

const execFile = promisify(execFileCallback);
const cleanupAckEnv = "CAPSULE_LIVE_CLEANUP_ACK";
const defaultAzureApiVersion = "2025-07-01";

const cleanupProviders = {
  fly: {
    requiredEnv: ["FLY_API_TOKEN", "FLY_APP_NAME"],
    notes: ["Finds Fly Machines with config.metadata.capsule_live_test=true and deletes only stale machines."]
  },
  kubernetes: {
    requiredEnv: ["CAPSULE_KUBERNETES_NAMESPACE"],
    notes: ["Finds Kubernetes Jobs, Deployments, and Services with label capsule_live_test=true and deletes only stale resources."]
  },
  "azure-container-apps": {
    requiredEnv: ["AZURE_ACCESS_TOKEN", "AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP"],
    notes: ["Finds Azure Container Apps services and jobs with tag capsule_live_test=true and deletes only stale resources."]
  }
};

const unsupportedNotes = {
  e2b: "E2B live labels are sandbox metadata, but this script has no provider-side list/delete-by-label API integration yet.",
  daytona: "Daytona live labels are create params, but this script has no provider-side list/delete-by-label API integration yet.",
  modal: "Modal live tests use deterministic names, but the current adapter does not map labels to a provider metadata field.",
  cloudflare: "Cloudflare Worker live labels are Capsule receipt metadata only; no provider-side Capsule cleanup tag is available.",
  "cloud-run": "Cloud Run live tests read an existing service and do not create Capsule-tagged resources.",
  vercel: "Vercel live tests read an existing deployment and do not create Capsule-tagged resources.",
  neon: "Neon labels and TTL are recorded in Capsule receipts only; no provider-side Capsule cleanup tag is available.",
  lambda: "Lambda live tests invoke an existing function and do not create Capsule-tagged resources."
};

function knownProviders(provider) {
  const providers = liveTestMatrixPlans.map((plan) => plan.provider);
  if (!provider) return providers;
  if (!providers.includes(provider)) {
    throw new Error(`Unknown cleanup provider "${provider}". Providers: ${providers.join(", ")}`);
  }
  return [provider];
}

function missingEnv(requiredEnv, env) {
  return requiredEnv.filter((name) => !env[name]);
}

function metadataValue(metadata, name) {
  const value = metadata?.[name];
  return typeof value === "string" ? value : undefined;
}

function expiresAtSeconds(metadata) {
  const raw = metadataValue(metadata, "capsule_expires_at");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function candidateResource(input, nowSeconds) {
  const expiresAt = expiresAtSeconds(input.metadata);
  const stale = expiresAt !== undefined && expiresAt <= nowSeconds;
  return {
    provider: input.provider,
    type: input.type,
    id: input.id,
    name: input.name,
    expiresAt,
    stale,
    action: stale ? "pending" : expiresAt === undefined ? "skip-no-expiry" : "skip-active"
  };
}

function resourceWithAction(resource, action) {
  return { ...resource, action };
}

async function requestJson(fetchImpl, input) {
  const response = await fetchImpl(input.url, {
    method: input.method ?? "GET",
    headers: input.headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${input.provider} cleanup API request failed with status ${response.status}`);
  }
  return data;
}

async function sweepFly(options) {
  const env = options.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const appName = env.FLY_APP_NAME;
  const token = env.FLY_API_TOKEN;
  const baseUrl = options.flyBaseUrl ?? "https://api.machines.dev";
  const headers = { accept: "application/json", authorization: `Bearer ${token}` };
  const listUrl = new URL(`/v1/apps/${encodeURIComponent(appName)}/machines`, baseUrl);
  listUrl.searchParams.set("metadata.capsule_live_test", "true");
  const data = await requestJson(fetchImpl, { provider: "fly", url: listUrl.toString(), headers });
  const machines = Array.isArray(data) ? data : data?.machines ?? [];
  const resources = machines
    .filter((machine) => metadataValue(machine?.config?.metadata, "capsule_live_test") === "true")
    .map((machine) =>
      candidateResource(
        {
          provider: "fly",
          type: "machine",
          id: String(machine.id ?? machine.name),
          name: String(machine.name ?? machine.id),
          metadata: machine.config?.metadata
        },
        options.nowSeconds
      )
    );

  return await applyDeletes(resources, options, async (resource) => {
    const deleteUrl = new URL(`/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(resource.id)}`, baseUrl);
    deleteUrl.searchParams.set("force", "true");
    await requestJson(fetchImpl, { provider: "fly", url: deleteUrl.toString(), method: "DELETE", headers });
  });
}

async function sweepAzure(options) {
  const env = options.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const subscriptionId = env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = env.AZURE_RESOURCE_GROUP;
  const apiVersion = env.AZURE_CONTAINERAPPS_API_VERSION ?? defaultAzureApiVersion;
  const baseUrl = options.azureBaseUrl ?? "https://management.azure.com";
  const headers = { accept: "application/json", authorization: `Bearer ${env.AZURE_ACCESS_TOKEN}` };
  const collectionUrl = (kind) =>
    `${baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.App/${kind}?api-version=${encodeURIComponent(apiVersion)}`;
  const [apps, jobs] = await Promise.all([
    requestJson(fetchImpl, { provider: "azure-container-apps", url: collectionUrl("containerApps"), headers }),
    requestJson(fetchImpl, { provider: "azure-container-apps", url: collectionUrl("jobs"), headers })
  ]);
  const resources = [
    ...(apps?.value ?? []).map((item) => ({ item, type: "containerApp" })),
    ...(jobs?.value ?? []).map((item) => ({ item, type: "job" }))
  ]
    .filter(({ item }) => metadataValue(item?.tags, "capsule_live_test") === "true")
    .map(({ item, type }) =>
      candidateResource(
        {
          provider: "azure-container-apps",
          type,
          id: String(item.id ?? item.name),
          name: String(item.name ?? item.id),
          metadata: item.tags
        },
        options.nowSeconds
      )
    );

  return await applyDeletes(resources, options, async (resource) => {
    const idPath = resource.id.startsWith("/") ? resource.id : `/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.App/${resource.type === "job" ? "jobs" : "containerApps"}/${encodeURIComponent(resource.name)}`;
    await requestJson(fetchImpl, {
      provider: "azure-container-apps",
      url: `${baseUrl}${idPath}?api-version=${encodeURIComponent(apiVersion)}`,
      method: "DELETE",
      headers
    });
  });
}

async function sweepKubernetes(options) {
  const env = options.env;
  const execFileImpl = options.execFile ?? execFile;
  const namespace = env.CAPSULE_KUBERNETES_NAMESPACE;
  const args = ["get", "jobs,deployments,services", "-n", namespace, "-l", "capsule_live_test=true", "-o", "json"];
  if (env.KUBECONFIG_CONTEXT) args.push("--context", env.KUBECONFIG_CONTEXT);
  if (env.KUBECONFIG) args.push("--kubeconfig", env.KUBECONFIG);
  const { stdout } = await execFileImpl("kubectl", args, { encoding: "utf8" });
  const list = JSON.parse(stdout);
  const resources = (list.items ?? [])
    .filter((item) => metadataValue(item?.metadata?.labels, "capsule_live_test") === "true")
    .map((item) =>
      candidateResource(
        {
          provider: "kubernetes",
          type: String(item.kind ?? "resource").toLowerCase(),
          id: String(item.metadata?.uid ?? item.metadata?.name),
          name: String(item.metadata?.name),
          metadata: item.metadata?.labels
        },
        options.nowSeconds
      )
    );

  return await applyDeletes(resources, options, async (resource) => {
    const deleteArgs = ["delete", resource.type, resource.name, "-n", namespace, "--wait=false"];
    if (env.KUBECONFIG_CONTEXT) deleteArgs.push("--context", env.KUBECONFIG_CONTEXT);
    if (env.KUBECONFIG) deleteArgs.push("--kubeconfig", env.KUBECONFIG);
    await execFileImpl("kubectl", deleteArgs, { encoding: "utf8" });
  });
}

async function applyDeletes(resources, options, deleteResource) {
  const result = [];
  for (const resource of resources) {
    if (!resource.stale) {
      result.push(resource);
      continue;
    }
    if (options.dryRun) {
      result.push(resourceWithAction(resource, "would-delete"));
      continue;
    }
    try {
      await deleteResource(resource);
      result.push(resourceWithAction(resource, "deleted"));
    } catch (error) {
      result.push({ ...resourceWithAction(resource, "delete-failed"), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

async function sweepSupportedProvider(provider, options) {
  if (provider === "fly") return await sweepFly(options);
  if (provider === "kubernetes") return await sweepKubernetes(options);
  if (provider === "azure-container-apps") return await sweepAzure(options);
  return [];
}

function providerSummary(provider, status, input = {}) {
  return {
    provider,
    status,
    requiredEnv: input.requiredEnv ?? cleanupProviders[provider]?.requiredEnv ?? [],
    missingEnv: input.missingEnv ?? [],
    resources: input.resources ?? [],
    notes: input.notes ?? cleanupProviders[provider]?.notes ?? []
  };
}

export async function createLiveCleanupSweep(options = {}) {
  const env = options.env ?? process.env;
  const dryRun = Boolean(options.dryRun);
  const deleteMode = Boolean(options.delete);
  const nowSeconds = Math.floor(((options.now ?? new Date()).getTime()) / 1000);
  const providers = [];

  for (const provider of knownProviders(options.provider)) {
    if (!cleanupProviders[provider]) {
      providers.push(providerSummary(provider, "unsupported", { notes: [unsupportedNotes[provider] ?? "No provider-side Capsule cleanup tag is available."] }));
      continue;
    }
    const requiredEnv = cleanupProviders[provider].requiredEnv;
    const missing = missingEnv(requiredEnv, env);
    const missingAck = deleteMode && env[cleanupAckEnv] !== "1" ? [cleanupAckEnv] : [];
    if (missing.length > 0 || missingAck.length > 0) {
      providers.push(providerSummary(provider, "blocked", { requiredEnv: [...requiredEnv, ...(deleteMode ? [cleanupAckEnv] : [])], missingEnv: [...missing, ...missingAck] }));
      continue;
    }
    try {
      const resources = await sweepSupportedProvider(provider, { ...options, env, dryRun, delete: deleteMode, nowSeconds });
      providers.push(providerSummary(provider, resources.some((resource) => resource.action === "delete-failed") ? "failed" : "ready", { resources }));
    } catch (error) {
      providers.push(providerSummary(provider, "failed", { notes: [error instanceof Error ? error.message : String(error)] }));
    }
  }

  const resources = providers.flatMap((provider) => provider.resources);
  return {
    dryRun,
    delete: deleteMode,
    summary: {
      providers: providers.length,
      candidates: resources.length,
      stale: resources.filter((resource) => resource.stale).length,
      deleted: resources.filter((resource) => resource.action === "deleted").length,
      failed: providers.filter((provider) => provider.status === "failed").length + resources.filter((resource) => resource.action === "delete-failed").length
    },
    providers
  };
}

function parseArgs(argv) {
  const parsed = { dryRun: false, delete: false, yes: false, provider: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--delete") {
      parsed.delete = true;
      continue;
    }
    if (arg === "--yes") {
      parsed.yes = true;
      continue;
    }
    if (arg === "--provider") {
      parsed.provider = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument "${arg}". Use --dry-run [--provider <provider>] or --delete --yes [--provider <provider>].`);
  }
  if (parsed.dryRun && parsed.delete) throw new Error("Use either --dry-run or --delete, not both.");
  if (!parsed.dryRun && !parsed.delete) throw new Error("Refusing to sweep live resources without --dry-run or --delete.");
  if (parsed.delete && !parsed.yes) throw new Error("Refusing to delete live resources without --yes and CAPSULE_LIVE_CLEANUP_ACK=1.");
  return parsed;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseArgs(argv);
  const report = await createLiveCleanupSweep({ ...parsed, env });
  console.log(JSON.stringify(report, null, 2));
  if (report.providers.some((provider) => provider.status === "failed") || (parsed.delete && report.providers.some((provider) => provider.status !== "ready"))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
