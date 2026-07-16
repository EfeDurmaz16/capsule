#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const liveTestMaxResourcesEnv = "CAPSULE_LIVE_TEST_MAX_RESOURCES";
const liveTestFlakyRevalidationEnv = "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY";
const liveTestCiOptInEnv = "CAPSULE_LIVE_TEST_CI_OPT_IN";
const liveTestCiUntrustedForkEnv = "CAPSULE_LIVE_TEST_UNTRUSTED_FORK";
const liveTestCiLabel = "capsule:live-tests";

export const liveTestMatrixPlans = [
  {
    provider: "e2b",
    testPath: "packages/adapter-e2b/src/e2b.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "E2B_API_KEY"],
    optionalEnv: [],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-e2b/src/e2b.live.test.ts",
    notes: ["Creates a sandbox, exercises exec and file operations, then destroys the sandbox."]
  },
  {
    provider: "daytona",
    testPath: "packages/adapter-daytona/src/daytona.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "DAYTONA_API_KEY"],
    optionalEnv: [],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-daytona/src/daytona.live.test.ts",
    notes: ["Creates an ephemeral sandbox with auto-stop configured and destroys it in finally."]
  },
  {
    provider: "modal",
    testPath: "packages/adapter-modal/src/modal.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
    optionalEnv: ["MODAL_APP_NAME", "MODAL_IMAGE", "MODAL_ENVIRONMENT"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-modal/src/modal.live.test.ts",
    notes: ["Creates a Modal sandbox, exercises exec and file operations, then destroys the sandbox."]
  },
  {
    provider: "cloud-run",
    testPath: "packages/adapter-cloud-run/src/cloud-run.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN", "CAPSULE_CLOUD_RUN_SERVICE_ID"],
    optionalEnv: [],
    costRisk: "read-only",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-cloud-run/src/cloud-run.live.test.ts",
    notes: ["Reads an existing Cloud Run service status; no resource is created."]
  },
  {
    provider: "cloudflare",
    testPath: "packages/adapter-cloudflare/src/cloudflare.live.test.ts",
    requiredEnv: [
      "CAPSULE_LIVE_TESTS",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CAPSULE_CLOUDFLARE_WORKER_NAME",
      "CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION"
    ],
    optionalEnv: ["CLOUDFLARE_COMPATIBILITY_DATE"],
    aliases: {
      CLOUDFLARE_API_TOKEN: ["CAPSULE_WORKER_API_TOKEN", "CLOUDFLARE_WORKERS_FREE_API_TOKEN"],
      CLOUDFLARE_ACCOUNT_ID: ["CAPSULE_WORKER_ACCOUNT_ID", "CLOUDFLARE_WORKERS_FREE_ACCOUNT_ID"]
    },
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command:
      'CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CAPSULE_WORKER_API_TOKEN}" CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CAPSULE_WORKER_ACCOUNT_ID}" CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-cloudflare/src/cloudflare.live.test.ts',
    notes: ["Creates an unreleased Worker version. Project-scoped Worker aliases can satisfy the Cloudflare token and account env vars."]
  },
  {
    provider: "vercel",
    testPath: "packages/adapter-vercel/src/vercel.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "VERCEL_TOKEN", "CAPSULE_VERCEL_DEPLOYMENT_ID"],
    optionalEnv: ["VERCEL_TEAM_ID", "VERCEL_TEAM_SLUG", "VERCEL_PROJECT_ID"],
    costRisk: "read-only",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-vercel/src/vercel.live.test.ts",
    notes: ["Reads an existing Vercel deployment status; no resource is created."]
  },
  {
    provider: "neon",
    testPath: "packages/adapter-neon/src/neon.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "NEON_API_KEY", "NEON_PROJECT_ID"],
    optionalEnv: ["NEON_PARENT_BRANCH_ID", "NEON_DATABASE", "NEON_ROLE", "NEON_POOLED"],
    aliases: { NEON_PROJECT_ID: ["CAPSULE_POSTGRES_PROJECT_ID"] },
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command:
      'NEON_PROJECT_ID="${NEON_PROJECT_ID:-$CAPSULE_POSTGRES_PROJECT_ID}" CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-neon/src/neon.live.test.ts',
    notes: ["Creates a Neon branch and hard-deletes it in finally. Project-scoped Postgres aliases can satisfy NEON_PROJECT_ID."]
  },
  {
    provider: "kubernetes",
    testPath: "packages/adapter-kubernetes/src/kubernetes.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "CAPSULE_KUBERNETES_NAMESPACE"],
    optionalEnv: ["KUBECONFIG", "KUBECONFIG_CONTEXT", "CAPSULE_KUBERNETES_IMAGE"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-kubernetes/src/kubernetes.live.test.ts",
    notes: ["Creates a Kubernetes Job and best-effort cancels it in finally."]
  },
  {
    provider: "lambda",
    testPath: "packages/adapter-lambda/src/lambda.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "AWS_REGION", "CAPSULE_LAMBDA_FUNCTION_NAME"],
    optionalEnv: ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_WEB_IDENTITY_TOKEN_FILE"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-lambda/src/lambda.live.test.ts",
    notes: ["Uses the AWS SDK default credential chain and invokes an existing Lambda function."]
  },
  {
    provider: "fly",
    testPath: "packages/adapter-fly/src/fly.live.test.ts",
    requiredEnv: ["CAPSULE_LIVE_TESTS", "FLY_API_TOKEN", "FLY_APP_NAME", "CAPSULE_FLY_IMAGE"],
    optionalEnv: ["FLY_REGION", "CAPSULE_FLY_MEMORY_MB", "CAPSULE_FLY_CPUS"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-fly/src/fly.live.test.ts",
    notes: ["Creates a Fly Machine and destroys it in finally."]
  },
  {
    provider: "azure-container-apps",
    testPath: "packages/adapter-azure-container-apps/src/azure-container-apps.live.test.ts",
    requiredEnv: [
      "CAPSULE_LIVE_TESTS",
      "AZURE_ACCESS_TOKEN",
      "AZURE_SUBSCRIPTION_ID",
      "AZURE_RESOURCE_GROUP",
      "AZURE_LOCATION",
      "AZURE_CONTAINERAPPS_ENVIRONMENT_ID",
      "CAPSULE_AZURE_CONTAINER_IMAGE"
    ],
    optionalEnv: ["CAPSULE_AZURE_CONTAINER_PORT"],
    costRisk: "billable",
    costAcknowledgementEnv: "CAPSULE_LIVE_TEST_COST_ACK",
    command: "CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-azure-container-apps/src/azure-container-apps.live.test.ts",
    notes: ["Deploys an Azure Container App service and deletes it in finally."]
  }
];

function configuredCredentialNames(name, aliases, env) {
  return [name, ...(aliases?.[name] ?? [])].filter((candidate) => Boolean(env[candidate]));
}

function resourceLimit(plan, env) {
  if (plan.costRisk !== "billable") return undefined;
  const resourceEnv = plan.maxResourceCountEnv ?? liveTestMaxResourcesEnv;
  const required = plan.maxResourceCount ?? 1;
  const raw = env[resourceEnv];
  const configured = raw === undefined ? undefined : Number(raw);
  const satisfied = configured !== undefined && Number.isSafeInteger(configured) && configured >= required;
  return { env: resourceEnv, required, configured, satisfied };
}

function readGitHubEvent(env) {
  if (!env.GITHUB_EVENT_PATH) return undefined;
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    return undefined;
  }
}

function githubEventLabels(env, event) {
  const eventLabels = [...(event?.pull_request?.labels ?? []), event?.label].flatMap((label) => (typeof label?.name === "string" ? [label.name] : []));
  const envLabels = (env.CAPSULE_LIVE_TEST_GITHUB_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return [...eventLabels, ...envLabels];
}

function githubEventIsUntrustedFork(env, event) {
  if (env[liveTestCiUntrustedForkEnv] === "1") return true;
  const pullRequest = event?.pull_request;
  if (!pullRequest && env.GITHUB_EVENT_NAME !== "pull_request") return false;
  if (pullRequest?.head?.repo?.fork === true) return true;

  const baseRepo = pullRequest?.base?.repo?.full_name ?? event?.repository?.full_name ?? env.GITHUB_REPOSITORY;
  const headRepo = pullRequest?.head?.repo?.full_name ?? env.GITHUB_HEAD_REPO_FULL_NAME;
  return Boolean(baseRepo && headRepo && baseRepo !== headRepo);
}

function liveTestCiSafety(env) {
  const ci = env.CI === "true" || env.GITHUB_ACTIONS === "true";
  if (!ci) return { ci: false, optedIn: true, untrustedFork: false };
  const event = readGitHubEvent(env);
  const labels = githubEventLabels(env, event);
  return {
    ci: true,
    optedIn: env[liveTestCiOptInEnv] === "1" || labels.includes(liveTestCiLabel),
    untrustedFork: githubEventIsUntrustedFork(env, event)
  };
}

function liveTestCiFields(ciSafety) {
  if (!ciSafety.ci) return {};
  return {
    missingCiOptInEnv: ciSafety.optedIn || ciSafety.untrustedFork ? [] : [liveTestCiOptInEnv],
    ciOptInEnv: liveTestCiOptInEnv,
    ciOptInLabel: liveTestCiLabel,
    ciUntrustedFork: ciSafety.untrustedFork
  };
}

function guardedCommand(plan) {
  if (plan.costRisk !== "billable") return plan.command;
  return `${plan.costAcknowledgementEnv ?? "CAPSULE_LIVE_TEST_COST_ACK"}=1 ${plan.maxResourceCountEnv ?? liveTestMaxResourcesEnv}=${plan.maxResourceCount ?? 1} ${plan.command}`;
}

function providerPlans(provider, plans = liveTestMatrixPlans) {
  if (!provider) return plans;
  const plan = plans.find((entry) => entry.provider === provider);
  if (!plan) {
    throw new Error(`Unknown live-test provider "${provider}". Providers: ${plans.map((entry) => entry.provider).join(", ")}`);
  }
  return [plan];
}

export function createLiveTestMatrix(options = {}) {
  const env = options.env ?? process.env;
  const providers = providerPlans(options.provider, options.plans).map((plan) => {
    const liveTestEnabled = env.CAPSULE_LIVE_TESTS === "1";
    const quarantineActive = Boolean(plan.quarantine && env[liveTestFlakyRevalidationEnv] !== "1");
    const ciSafety = liveTestCiSafety(env);
    const ciBlocked = ciSafety.ci && (!ciSafety.optedIn || ciSafety.untrustedFork);
    const requiredWithoutFlag = plan.requiredEnv.filter((name) => name !== "CAPSULE_LIVE_TESTS");
    const configuredEnv = requiredWithoutFlag.flatMap((name) => configuredCredentialNames(name, plan.aliases, env));
    const missingRequired = requiredWithoutFlag.filter((name) => configuredCredentialNames(name, plan.aliases, env).length === 0);
    const costEnv = plan.costAcknowledgementEnv;
    const costAcknowledged = costEnv ? env[costEnv] === "1" : true;
    const missingCostEnv = costEnv && !costAcknowledged ? [costEnv] : [];
    const limit = resourceLimit(plan, env);
    const missingResourceLimitEnv = limit && !limit.satisfied ? [limit.env] : [];
    const missingEnv = liveTestEnabled ? missingRequired : ["CAPSULE_LIVE_TESTS", ...missingRequired];
    const ready = !ciBlocked && liveTestEnabled && missingRequired.length === 0 && missingCostEnv.length === 0 && missingResourceLimitEnv.length === 0;
    const status = ciBlocked ? "blocked" : quarantineActive ? "quarantined" : ready ? "ready" : "blocked";

    return {
      provider: plan.provider,
      status,
      wouldRun: status === "ready",
      liveTestEnabled,
      costRisk: plan.costRisk,
      costAcknowledged,
      resourceLimit: limit,
      configuredEnv: [
        ...(liveTestEnabled ? ["CAPSULE_LIVE_TESTS"] : []),
        ...configuredEnv,
        ...(costEnv && costAcknowledged ? [costEnv] : []),
        ...(limit?.satisfied ? [limit.env] : []),
        ...(ciSafety.ci && env[liveTestCiOptInEnv] === "1" ? [liveTestCiOptInEnv] : []),
        ...(plan.quarantine && env[liveTestFlakyRevalidationEnv] === "1" ? [liveTestFlakyRevalidationEnv] : [])
      ],
      missingEnv,
      missingCostEnv,
      missingResourceLimitEnv,
      requiredEnv: plan.requiredEnv.flatMap((name) => [name, ...(plan.aliases?.[name] ?? [])]),
      optionalEnv: plan.optionalEnv,
      testPath: plan.testPath,
      command: guardedCommand(plan),
      ...liveTestCiFields(ciSafety),
      ...(plan.quarantine
        ? {
            quarantine: plan.quarantine,
            quarantineRevalidationEnv: liveTestFlakyRevalidationEnv
          }
        : {}),
      notes: plan.notes
    };
  });
  const summary = {
    total: providers.length,
    ready: providers.filter((entry) => entry.status === "ready").length,
    blocked: providers.filter((entry) => entry.status === "blocked").length,
    quarantined: providers.filter((entry) => entry.status === "quarantined").length,
    ciBlocked: providers.filter((entry) => entry.ciUntrustedFork || (entry.missingCiOptInEnv?.length ?? 0) > 0).length,
    billable: providers.filter((entry) => entry.costRisk === "billable").length,
    readOnly: providers.filter((entry) => entry.costRisk === "read-only").length
  };

  return { dryRun: true, summary, providers };
}

function parseArgs(argv) {
  const parsed = { dryRun: false, provider: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--provider") {
      parsed.provider = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument "${arg}". Use --dry-run [--provider <provider>].`);
  }
  return parsed;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseArgs(argv);
  if (!parsed.dryRun) {
    throw new Error("Refusing to inspect live-test environment without --dry-run.");
  }
  const report = createLiveTestMatrix({ env, provider: parsed.provider });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
