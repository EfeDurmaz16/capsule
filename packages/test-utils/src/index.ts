import { readFileSync } from "node:fs";

export type LiveTestEnv = Record<string, string | undefined>;
export { liveResourceMetadata, type LiveResourceMetadata, type LiveResourceMetadataOptions } from "./live-resources.js";

export interface LiveTestGate {
  enabled: boolean;
  skipReason?: string;
  quarantine?: LiveTestQuarantine;
}

export interface LiveTestQuarantine {
  reason: string;
  lastObservedFailure: string;
  owner: string;
  revalidationCommand: string;
}

export interface LiveProviderRequirement {
  provider: string;
  credentials?: readonly string[];
  env?: LiveTestEnv;
  costRisk?: LiveProviderCostRisk;
  maxResourceCount?: number;
  quarantine?: LiveTestQuarantine;
}

export interface LiveProviderRegistryEntry {
  provider: string;
  packageName: `@capsule-sdk/${string}`;
  credentials: readonly string[];
  notes?: readonly string[];
}

export interface LiveTestApi {
  skipIf(condition: boolean): (name: string, fn: () => unknown | Promise<unknown>, timeout?: number) => void;
}

const liveFlag = "CAPSULE_LIVE_TESTS";
const liveCostAcknowledgementEnv = "CAPSULE_LIVE_TEST_COST_ACK";
const liveMaxResourcesEnv = "CAPSULE_LIVE_TEST_MAX_RESOURCES";
const liveFlakyRevalidationEnv = "CAPSULE_LIVE_TEST_REVALIDATE_FLAKY";
const liveCiOptInEnv = "CAPSULE_LIVE_TEST_CI_OPT_IN";
const liveCiUntrustedForkEnv = "CAPSULE_LIVE_TEST_UNTRUSTED_FORK";
const liveCiLabel = "capsule:live-tests";

export type LiveProviderCostRisk = "none" | "read-only" | "billable";

export const liveProviderCredentials = {
  aws: ["AWS_REGION", "CAPSULE_LAMBDA_FUNCTION_NAME"],
  azure: ["AZURE_ACCESS_TOKEN", "AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP", "AZURE_LOCATION", "AZURE_CONTAINERAPPS_ENVIRONMENT_ID"],
  "cloud-run": ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_RUN_LOCATION", "GOOGLE_OAUTH_ACCESS_TOKEN"],
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  daytona: ["DAYTONA_API_KEY"],
  docker: [],
  e2b: ["E2B_API_KEY"],
  ec2: ["AWS_REGION"],
  ecs: ["AWS_REGION", "CAPSULE_ECS_CLUSTER", "CAPSULE_ECS_TASK_DEFINITION", "CAPSULE_ECS_CONTAINER_NAME"],
  fly: ["FLY_API_TOKEN", "FLY_APP_NAME"],
  kubernetes: ["CAPSULE_KUBERNETES_NAMESPACE"],
  lambda: ["AWS_REGION", "CAPSULE_LAMBDA_FUNCTION_NAME"],
  modal: ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
  neon: ["NEON_API_KEY", "NEON_PROJECT_ID"],
  vercel: ["VERCEL_TOKEN"]
} as const;

export const liveProviderCostRisk: Record<string, LiveProviderCostRisk> = {
  aws: "billable",
  azure: "billable",
  "azure-container-apps": "billable",
  "cloud-run": "read-only",
  cloudflare: "billable",
  daytona: "billable",
  docker: "none",
  e2b: "billable",
  ec2: "billable",
  ecs: "billable",
  fly: "billable",
  kubernetes: "billable",
  lambda: "billable",
  modal: "billable",
  neon: "billable",
  vercel: "read-only"
};

export const liveProviderMaxResourceCount: Record<string, number> = {
  aws: 1,
  azure: 1,
  "azure-container-apps": 1,
  cloudflare: 1,
  daytona: 1,
  e2b: 1,
  ec2: 1,
  ecs: 1,
  fly: 1,
  kubernetes: 1,
  lambda: 1,
  modal: 1,
  neon: 1
};

export const liveProviderRegistry = [
  { provider: "docker", packageName: "@capsule-sdk/docker", credentials: liveProviderCredentials.docker, notes: ["Uses the local Docker daemon."] },
  { provider: "e2b", packageName: "@capsule-sdk/e2b", credentials: liveProviderCredentials.e2b },
  { provider: "daytona", packageName: "@capsule-sdk/daytona", credentials: liveProviderCredentials.daytona },
  { provider: "modal", packageName: "@capsule-sdk/modal", credentials: liveProviderCredentials.modal },
  { provider: "cloud-run", packageName: "@capsule-sdk/cloud-run", credentials: liveProviderCredentials["cloud-run"] },
  { provider: "cloudflare", packageName: "@capsule-sdk/cloudflare", credentials: liveProviderCredentials.cloudflare },
  { provider: "vercel", packageName: "@capsule-sdk/vercel", credentials: liveProviderCredentials.vercel },
  { provider: "neon", packageName: "@capsule-sdk/neon", credentials: liveProviderCredentials.neon },
  { provider: "kubernetes", packageName: "@capsule-sdk/kubernetes", credentials: liveProviderCredentials.kubernetes },
  { provider: "lambda", packageName: "@capsule-sdk/lambda", credentials: liveProviderCredentials.lambda, notes: ["Uses AWS SDK ambient credentials."] },
  { provider: "ecs", packageName: "@capsule-sdk/ecs", credentials: liveProviderCredentials.ecs, notes: ["Uses AWS SDK ambient credentials."] },
  { provider: "ec2", packageName: "@capsule-sdk/ec2", credentials: liveProviderCredentials.ec2, notes: ["Uses AWS SDK ambient credentials."] },
  { provider: "fly", packageName: "@capsule-sdk/fly", credentials: liveProviderCredentials.fly },
  { provider: "azure-container-apps", packageName: "@capsule-sdk/azure", credentials: liveProviderCredentials.azure }
] as const satisfies readonly LiveProviderRegistryEntry[];

function quarantineSkipReason(provider: string, quarantine: LiveTestQuarantine): string {
  return `${provider} live test is quarantined: ${quarantine.reason}. Owner: ${quarantine.owner}. Last observed failure: ${quarantine.lastObservedFailure}. Revalidate with: ${quarantine.revalidationCommand}`;
}

function readGitHubEvent(env: LiveTestEnv): Record<string, any> | undefined {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    return JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function githubEventLabels(env: LiveTestEnv, event: Record<string, any> | undefined): string[] {
  const eventLabels = [...(event?.pull_request?.labels ?? []), event?.label].flatMap((label) => (typeof label?.name === "string" ? [label.name] : []));
  const envLabels = (env.CAPSULE_LIVE_TEST_GITHUB_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return [...eventLabels, ...envLabels];
}

function githubEventIsUntrustedFork(env: LiveTestEnv, event: Record<string, any> | undefined): boolean {
  if (env[liveCiUntrustedForkEnv] === "1") return true;
  const pullRequest = event?.pull_request;
  if (!pullRequest && env.GITHUB_EVENT_NAME !== "pull_request") return false;
  if (pullRequest?.head?.repo?.fork === true) return true;

  const baseRepo = pullRequest?.base?.repo?.full_name ?? event?.repository?.full_name ?? env.GITHUB_REPOSITORY;
  const headRepo = pullRequest?.head?.repo?.full_name ?? env.GITHUB_HEAD_REPO_FULL_NAME;
  return Boolean(baseRepo && headRepo && baseRepo !== headRepo);
}

function liveTestCiSafety(env: LiveTestEnv): { ci: boolean; optedIn: boolean; untrustedFork: boolean } {
  const ci = env.CI === "true" || env.GITHUB_ACTIONS === "true";
  if (!ci) return { ci: false, optedIn: true, untrustedFork: false };
  const event = readGitHubEvent(env);
  const labels = githubEventLabels(env, event);
  return {
    ci: true,
    optedIn: env[liveCiOptInEnv] === "1" || labels.includes(liveCiLabel),
    untrustedFork: githubEventIsUntrustedFork(env, event)
  };
}

export function liveTestGate(requirement: LiveProviderRequirement): LiveTestGate {
  const env = requirement.env ?? process.env;
  const provider = requirement.provider;
  const quarantine = requirement.quarantine;
  const ciSafety = liveTestCiSafety(env);

  if (ciSafety.ci && ciSafety.untrustedFork) {
    return {
      enabled: false,
      skipReason: `${provider} live tests are disabled for untrusted fork pull requests.`
    };
  }

  if (ciSafety.ci && !ciSafety.optedIn) {
    return {
      enabled: false,
      skipReason: `${provider} live tests require ${liveCiOptInEnv}=1 or GitHub label ${liveCiLabel} in CI.`
    };
  }

  if (quarantine && env[liveFlakyRevalidationEnv] !== "1") {
    return {
      enabled: false,
      skipReason: quarantineSkipReason(provider, quarantine),
      quarantine
    };
  }

  if (env[liveFlag] !== "1") {
    return {
      enabled: false,
      skipReason: `${provider} live tests require ${liveFlag}=1.`
    };
  }

  const missing = (requirement.credentials ?? []).filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      enabled: false,
      skipReason: `${provider} live tests require credential env var${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`
    };
  }

  const costRisk = requirement.costRisk ?? liveProviderCostRisk[provider] ?? "none";
  if (costRisk === "billable") {
    if (env[liveCostAcknowledgementEnv] !== "1") {
      return {
        enabled: false,
        skipReason: `${provider} live tests require ${liveCostAcknowledgementEnv}=1 for billable provider work.`
      };
    }

    const requiredMaxResources = requirement.maxResourceCount ?? liveProviderMaxResourceCount[provider] ?? 1;
    const configuredMaxResources = Number(env[liveMaxResourcesEnv]);
    if (!Number.isSafeInteger(configuredMaxResources) || configuredMaxResources < requiredMaxResources) {
      return {
        enabled: false,
        skipReason: `${provider} live tests require ${liveMaxResourcesEnv} to be a positive integer >= ${requiredMaxResources}.`
      };
    }
  }

  return quarantine ? { enabled: true, quarantine } : { enabled: true };
}

export function providerLiveTestGate(
  provider: keyof typeof liveProviderCredentials,
  options: {
    env?: LiveTestEnv;
    credentials?: readonly string[];
    costRisk?: LiveProviderCostRisk;
    maxResourceCount?: number;
    quarantine?: LiveTestQuarantine;
  } = {}
): LiveTestGate {
  return liveTestGate({
    provider,
    credentials: options.credentials ?? liveProviderCredentials[provider],
    env: options.env,
    costRisk: options.costRisk,
    maxResourceCount: options.maxResourceCount,
    quarantine: options.quarantine
  });
}

export function liveTest(
  testApi: LiveTestApi,
  name: string,
  requirement: LiveProviderRequirement | LiveTestGate,
  fn: () => unknown | Promise<unknown>,
  timeout?: number
): void {
  const gate = "enabled" in requirement ? requirement : liveTestGate(requirement);
  const testName = gate.enabled ? name : `${name} (skipped: ${gate.skipReason})`;
  testApi.skipIf(!gate.enabled)(testName, fn, timeout);
}
