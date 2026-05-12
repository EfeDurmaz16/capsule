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
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  neon: ["NEON_API_KEY"],
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
