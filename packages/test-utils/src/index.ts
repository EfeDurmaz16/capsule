export type LiveTestEnv = Record<string, string | undefined>;

export interface LiveTestGate {
  enabled: boolean;
  skipReason?: string;
}

export interface LiveProviderRequirement {
  provider: string;
  credentials?: readonly string[];
  env?: LiveTestEnv;
}

export interface LiveProviderRegistryEntry {
  provider: string;
  packageName: `@capsule/${string}`;
  credentials: readonly string[];
  notes?: readonly string[];
}

export interface LiveTestApi {
  skipIf(condition: boolean): (name: string, fn: () => unknown | Promise<unknown>, timeout?: number) => void;
}

const liveFlag = "CAPSULE_LIVE_TESTS";

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

export const liveProviderRegistry = [
  { provider: "docker", packageName: "@capsule/adapter-docker", credentials: liveProviderCredentials.docker, notes: ["Uses the local Docker daemon."] },
  { provider: "e2b", packageName: "@capsule/adapter-e2b", credentials: liveProviderCredentials.e2b },
  { provider: "daytona", packageName: "@capsule/adapter-daytona", credentials: liveProviderCredentials.daytona },
  { provider: "modal", packageName: "@capsule/adapter-modal", credentials: liveProviderCredentials.modal },
  { provider: "cloud-run", packageName: "@capsule/adapter-cloud-run", credentials: liveProviderCredentials["cloud-run"] },
  { provider: "cloudflare", packageName: "@capsule/adapter-cloudflare", credentials: liveProviderCredentials.cloudflare },
  { provider: "vercel", packageName: "@capsule/adapter-vercel", credentials: liveProviderCredentials.vercel },
  { provider: "neon", packageName: "@capsule/adapter-neon", credentials: liveProviderCredentials.neon },
  { provider: "kubernetes", packageName: "@capsule/adapter-kubernetes", credentials: liveProviderCredentials.kubernetes },
  { provider: "lambda", packageName: "@capsule/adapter-lambda", credentials: liveProviderCredentials.lambda, notes: ["Uses AWS SDK ambient credentials."] },
  { provider: "ecs", packageName: "@capsule/adapter-ecs", credentials: liveProviderCredentials.ecs, notes: ["Uses AWS SDK ambient credentials."] },
  { provider: "ec2", packageName: "@capsule/adapter-ec2", credentials: liveProviderCredentials.ec2, notes: ["Uses AWS SDK ambient credentials."] },
  { provider: "fly", packageName: "@capsule/adapter-fly", credentials: liveProviderCredentials.fly },
  { provider: "azure-container-apps", packageName: "@capsule/adapter-azure-container-apps", credentials: liveProviderCredentials.azure }
] as const satisfies readonly LiveProviderRegistryEntry[];

export function liveTestGate(requirement: LiveProviderRequirement): LiveTestGate {
  const env = requirement.env ?? process.env;
  const provider = requirement.provider;

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

  return { enabled: true };
}

export function providerLiveTestGate(
  provider: keyof typeof liveProviderCredentials,
  options: { env?: LiveTestEnv; credentials?: readonly string[] } = {}
): LiveTestGate {
  return liveTestGate({
    provider,
    credentials: options.credentials ?? liveProviderCredentials[provider],
    env: options.env
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
