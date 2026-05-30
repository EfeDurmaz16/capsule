import { createHash } from "node:crypto";

type LiveResourceEnv = Record<string, string | undefined>;

export interface LiveResourceMetadataOptions {
  provider: string;
  resource: string;
  env?: LiveResourceEnv;
  now?: Date;
  ttlMs?: number;
  maxNameLength?: number;
}

export interface LiveResourceMetadata {
  name: string;
  labels: Record<string, string>;
  ttlMs: number;
}

const defaultLiveResourceTtlMs = 60 * 60 * 1000;
const defaultMaxNameLength = 63;

function firstDefined(env: LiveResourceEnv, names: readonly string[]): string | undefined {
  return names.map((name) => env[name]).find((value): value is string => Boolean(value));
}

function sanitizeLabelValue(value: string | undefined, fallback: string): string {
  const sanitized = (value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return truncateWithHash(sanitized || fallback, 63);
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truncateWithHash(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength < 12) {
    throw new Error("maxNameLength must be at least 12.");
  }
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  const prefix = value.slice(0, maxLength - hash.length - 1).replace(/-+$/g, "");
  return `${prefix}-${hash}`;
}

function repoName(env: LiveResourceEnv): string {
  const configured = firstDefined(env, ["CAPSULE_LIVE_TEST_REPO", "CAPSULE_LIVE_REPO", "GITHUB_REPOSITORY"]);
  return configured?.split("/").filter(Boolean).at(-1) ?? "capsule";
}

function runId(env: LiveResourceEnv): string {
  const explicit = firstDefined(env, ["CAPSULE_LIVE_TEST_RUN_ID", "CAPSULE_LIVE_RUN_ID"]);
  if (explicit) return explicit;

  const githubRunId = env.GITHUB_RUN_ID;
  if (githubRunId) {
    return env.GITHUB_RUN_ATTEMPT ? `${githubRunId}-${env.GITHUB_RUN_ATTEMPT}` : githubRunId;
  }

  return firstDefined(env, ["CI_PIPELINE_ID", "BUILD_ID"]) ?? "local";
}

function liveResourceTtlMs(options: LiveResourceMetadataOptions): number {
  const raw = options.env?.CAPSULE_LIVE_TEST_TTL_MS;
  if (raw === undefined) return options.ttlMs ?? defaultLiveResourceTtlMs;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("CAPSULE_LIVE_TEST_TTL_MS must be a positive integer.");
  }
  return parsed;
}

export function liveResourceMetadata(options: LiveResourceMetadataOptions): LiveResourceMetadata {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const ttlMs = liveResourceTtlMs({ ...options, env });
  const owner = sanitizeLabelValue(firstDefined(env, ["CAPSULE_LIVE_TEST_OWNER", "CAPSULE_LIVE_OWNER", "GITHUB_ACTOR", "USER"]), "local");
  const repo = sanitizeLabelValue(repoName(env), "capsule");
  const provider = sanitizeLabelValue(options.provider, "provider");
  const resource = sanitizeLabelValue(options.resource, "resource");
  const run = sanitizeLabelValue(runId(env), "local");
  const expiresAt = Math.floor((now.getTime() + ttlMs) / 1000).toString();
  const fullName = sanitizeName(`capsule-live-${provider}-${resource}-${run}`) || "capsule-live-resource";
  const name = truncateWithHash(fullName, options.maxNameLength ?? defaultMaxNameLength);

  return {
    name,
    labels: {
      capsule_live_test: "true",
      capsule_managed_by: "capsule",
      capsule_owner: owner,
      capsule_provider: provider,
      capsule_repo: repo,
      capsule_resource: resource,
      capsule_run_id: run,
      capsule_ttl_ms: String(ttlMs),
      capsule_expires_at: expiresAt
    },
    ttlMs
  };
}
