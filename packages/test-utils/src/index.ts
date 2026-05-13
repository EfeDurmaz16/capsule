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
  fly: ["FLY_API_TOKEN", "FLY_APP_NAME"],
  kubernetes: ["CAPSULE_KUBERNETES_NAMESPACE"],
  modal: ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
  neon: ["NEON_API_KEY", "NEON_PROJECT_ID"],
  vercel: ["VERCEL_TOKEN"]
} as const;

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
