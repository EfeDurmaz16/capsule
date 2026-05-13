import { pathToFileURL } from "node:url";
import { Capsule, type CapsuleReceipt, type CapabilityMap } from "@capsule/core";
import { createMockAdapter } from "@capsule/adapter-mock";
import { neon } from "@capsule/adapter-neon";
import { vercel } from "@capsule/adapter-vercel";
import { cloudRun } from "@capsule/adapter-cloud-run";
import { createPreviewGraph, cleanupPreviewEnvironment, type PreviewPlan } from "@capsule/preview";
import { jsonlReceiptStore } from "@capsule/store-jsonl";

type Env = Record<string, string | undefined>;

interface RuntimeConfig {
  mode: "demo-only" | "live";
  plan: PreviewPlan;
  receiptPath: string;
  missingLiveCredentials: string[];
  liveProviders: string[];
}

interface ReceiptSummary {
  id: string;
  type: CapsuleReceipt["type"];
  provider: string;
  adapter: string;
  capabilityPath: string;
  supportLevel: CapsuleReceipt["supportLevel"];
  resource?: CapsuleReceipt["resource"];
}

const liveFlag = "CAPSULE_LIVE_TESTS";
const previewName = "pr-42";
const defaultReceiptPath = ".capsule/receipts/preview-environment-model.jsonl";
const edgeSourcePath = new URL("./worker.js", import.meta.url).pathname;
const unsupported = "unsupported";

const demoOnlyCapabilities: CapabilityMap = {
  database: {
    branchCreate: "native",
    branchDelete: "native",
    branchReset: unsupported,
    connectionString: unsupported,
    migrate: unsupported
  },
  edge: {
    deploy: "native",
    version: unsupported,
    release: unsupported,
    rollback: unsupported,
    routes: unsupported,
    bindings: unsupported,
    logs: unsupported,
    url: "native"
  },
  job: {
    run: "native",
    status: unsupported,
    cancel: unsupported,
    logs: unsupported,
    artifacts: unsupported,
    timeout: "native",
    env: "native",
    resources: unsupported
  },
  preview: {
    create: unsupported,
    destroy: unsupported,
    status: unsupported,
    logs: unsupported,
    urls: unsupported,
    ttl: unsupported,
    cleanup: unsupported
  }
};

function hasAll(env: Env, names: string[]): boolean {
  return names.every((name) => Boolean(env[name]));
}

function missing(env: Env, names: string[]): string[] {
  return names.filter((name) => !env[name]);
}

function capsule(adapter: ConstructorParameters<typeof Capsule>[0]["adapter"], receiptPath: string): Capsule {
  return new Capsule({
    adapter,
    receipts: true,
    receiptStore: jsonlReceiptStore(receiptPath),
    policy: { ttl: { maxMs: 86_400_000 }, cost: { maxUsd: 5 } }
  });
}

function demoPlan(receiptPath: string): PreviewPlan {
  const demo = capsule(
    createMockAdapter({
      name: "demo-only-preview",
      provider: "demo-only",
      capabilities: demoOnlyCapabilities
    }),
    receiptPath
  );

  return {
    name: previewName,
    requireRealProviders: true,
    allowMockProviders: true,
    labels: { example: "preview-environment-model", mode: "demo-only" },
    databases: [{ capsule: demo, spec: { project: "demo-app", name: previewName } }],
    edges: [{ capsule: demo, spec: { name: "web", source: { path: edgeSourcePath, entrypoint: "worker.js" } } }],
    jobs: [{ capsule: demo, spec: { name: "smoke", image: "gcr.io/cloudrun/hello", command: "echo ok" } }]
  };
}

function livePlan(env: Env, receiptPath: string): PreviewPlan {
  const database = capsule(
    neon({
      apiKey: env.NEON_API_KEY,
      databaseName: env.NEON_DATABASE,
      roleName: env.NEON_ROLE,
      pooled: env.NEON_POOLED === "1"
    }),
    receiptPath
  );
  const edge = capsule(
    vercel({
      token: env.VERCEL_TOKEN,
      project: env.VERCEL_PROJECT,
      teamId: env.VERCEL_TEAM_ID,
      target: "preview"
    }),
    receiptPath
  );

  const plan: PreviewPlan = {
    name: env.CAPSULE_EXAMPLE_PREVIEW_NAME ?? previewName,
    requireRealProviders: true,
    labels: { example: "preview-environment-model", mode: "live" },
    databases: [
      {
        capsule: database,
        spec: {
          project: env.NEON_PROJECT_ID ?? "",
          parent: env.NEON_PARENT_BRANCH_ID,
          name: env.CAPSULE_EXAMPLE_BRANCH_NAME ?? previewName,
          ttlMs: 86_400_000,
          labels: { "capsule-example": "preview-environment-model" }
        }
      }
    ],
    edges: [
      {
        capsule: edge,
        spec: {
          name: env.CAPSULE_EXAMPLE_EDGE_NAME ?? "capsule-preview-example",
          source: { path: edgeSourcePath, entrypoint: "worker.js" },
          labels: { "capsule-example": "preview-environment-model" }
        }
      }
    ]
  };

  if (hasAll(env, ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN"])) {
    const service = capsule(
      cloudRun({
        projectId: env.GOOGLE_CLOUD_PROJECT,
        location: env.GOOGLE_CLOUD_RUN_LOCATION,
        accessToken: env.GOOGLE_OAUTH_ACCESS_TOKEN,
        waitForOperations: env.CAPSULE_EXAMPLE_WAIT_FOR_OPERATIONS !== "0"
      }),
      receiptPath
    );
    plan.services = [
      {
        capsule: service,
        spec: {
          name: env.CAPSULE_EXAMPLE_SERVICE_NAME ?? "capsule-preview-api",
          image: env.CAPSULE_EXAMPLE_SERVICE_IMAGE ?? "us-docker.pkg.dev/cloudrun/container/hello",
          labels: { "capsule-example": "preview-environment-model" }
        }
      }
    ];
  }

  return plan;
}

export function buildRuntimeConfig(env: Env = process.env): RuntimeConfig {
  const receiptPath = env.CAPSULE_EXAMPLE_RECEIPTS_PATH ?? defaultReceiptPath;
  const requiredLiveCredentials = ["NEON_API_KEY", "NEON_PROJECT_ID", "VERCEL_TOKEN"];
  const missingLiveCredentials = missing(env, requiredLiveCredentials);

  if (env[liveFlag] !== "1") {
    return {
      mode: "demo-only",
      plan: demoPlan(receiptPath),
      receiptPath,
      missingLiveCredentials,
      liveProviders: []
    };
  }

  if (missingLiveCredentials.length > 0) {
    throw new Error(
      `Live preview verification requires ${requiredLiveCredentials.join(", ")} with ${liveFlag}=1. Missing: ${missingLiveCredentials.join(", ")}. Mock fallback is demo-only and cannot satisfy live verification.`
    );
  }

  return {
    mode: "live",
    plan: livePlan(env, receiptPath),
    receiptPath,
    missingLiveCredentials: [],
    liveProviders: [
      "neon",
      "vercel",
      ...(hasAll(env, ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN"]) ? ["cloud-run"] : [])
    ]
  };
}

export function summarizeReceipt(receipt: CapsuleReceipt): ReceiptSummary {
  return {
    id: receipt.id,
    type: receipt.type,
    provider: receipt.provider,
    adapter: receipt.adapter,
    capabilityPath: receipt.capabilityPath,
    supportLevel: receipt.supportLevel,
    resource: receipt.resource
  };
}

function printReceipts(label: string, receipts: CapsuleReceipt[]): void {
  console.log(`${label}: ${receipts.length}`);
  for (const receipt of receipts) {
    console.log(JSON.stringify(summarizeReceipt(receipt)));
  }
}

export async function run(env: Env = process.env): Promise<void> {
  const config = buildRuntimeConfig(env);

  if (config.mode === "demo-only") {
    console.log(
      `Example mode: demo-only mock preview composition. No real provider APIs are called. Set ${liveFlag}=1, NEON_API_KEY, NEON_PROJECT_ID, and VERCEL_TOKEN for live verification.`
    );
  } else {
    console.log(`Example mode: live preview composition with ${config.liveProviders.join(", ")}.`);
  }
  console.log(`Receipt store: ${config.receiptPath}`);

  const graph = await createPreviewGraph(config.plan);
  console.log(JSON.stringify({ preview: graph.preview, resources: graph.resources.map(({ cleanup, receipt, ...resource }) => resource) }, null, 2));
  printReceipts("create receipts", graph.receipts);

  const cleanup = await cleanupPreviewEnvironment(graph.preview, graph.resources);
  console.log(JSON.stringify({ cleanup: { previewId: cleanup.previewId, status: cleanup.status, cleaned: cleanup.cleaned.length, failed: cleanup.failed.length } }, null, 2));
  printReceipts("cleanup receipts", cleanup.receipts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
