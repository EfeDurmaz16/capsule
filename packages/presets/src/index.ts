import type {
  CapsulePolicy,
  CapsulePreset,
  CreateDatabaseBranchSpec,
  CreateMachineSpec,
  CreatePreviewSpec,
  DeployEdgeSpec,
  DeployServiceSpec,
  ProviderOptions,
  ProviderOptionValue,
  RunJobSpec
} from "@capsule/core";
import { agentSafePolicy } from "@capsule/core";

function providerOptions(input: Record<string, ProviderOptionValue | undefined>): ProviderOptions {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, ProviderOptionValue] => entry[1] !== undefined));
}

function requireNonEmptyString(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePositiveNumber(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${field} must be greater than 0`);
  }
}

function validateNonNegativeInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new RangeError(`${field} must be greater than or equal to 0`);
  }
}

function validatePort(port: number, field: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`${field} must be between 1 and 65535`);
  }
  return port;
}

function validateScale(minScale: number | undefined, maxScale: number | undefined, preset: string): void {
  validateNonNegativeInteger(minScale, `${preset} minScale`);
  validateNonNegativeInteger(maxScale, `${preset} maxScale`);
  if (minScale !== undefined && maxScale !== undefined && minScale > maxScale) {
    throw new RangeError(`${preset} minScale must be less than or equal to maxScale`);
  }
}

function validatePolicyCompatibility(policy: CapsulePolicy): void {
  if (policy.network?.mode === "allowlist" && !(policy.network.allowedHosts ?? []).some(isNonEmptyString)) {
    throw new TypeError("network allowlist requires at least one allowed host");
  }
}

export interface FlyMachinePresetOptions {
  name: string;
  image: string;
  region?: string;
  env?: Record<string, string>;
  memoryMb?: number;
  cpu?: number;
  labels?: Record<string, string>;
}

export function flyMachinePreset(options: FlyMachinePresetOptions): CapsulePreset<CreateMachineSpec> {
  const name = requireNonEmptyString(options.name, "fly-machine name");
  const image = requireNonEmptyString(options.image, "fly-machine image");
  validatePositiveNumber(options.memoryMb, "fly-machine memoryMb");
  validatePositiveNumber(options.cpu, "fly-machine cpu");

  return {
    name: "fly-machine",
    domain: "machine",
    capabilityPaths: ["machine.create", "machine.status", "machine.start", "machine.stop", "machine.destroy"],
    spec: {
      name,
      image,
      region: options.region,
      env: options.env,
      labels: { ...options.labels, "capsule.io/preset": "fly-machine" },
      providerOptions: providerOptions({
        memoryMb: options.memoryMb,
        cpu: options.cpu
      })
    },
    notes: [
      "Targets Fly Machines through @capsule/adapter-fly.",
      "Fly app, process group, services, volumes, autostart, autostop, and network semantics remain Fly-specific."
    ]
  };
}

export interface FlyHttpServicePresetOptions extends FlyMachinePresetOptions {
  port?: number;
  minScale?: number;
  maxScale?: number;
}

export function flyHttpServicePreset(options: FlyHttpServicePresetOptions): CapsulePreset<DeployServiceSpec> {
  const name = requireNonEmptyString(options.name, "fly-http-service name");
  const image = requireNonEmptyString(options.image, "fly-http-service image");
  const port = validatePort(options.port ?? 8080, "fly-http-service port");
  validatePositiveNumber(options.memoryMb, "fly-http-service memoryMb");
  validatePositiveNumber(options.cpu, "fly-http-service cpu");
  validateScale(options.minScale, options.maxScale, "fly-http-service");

  return {
    name: "fly-http-service",
    domain: "service",
    capabilityPaths: ["service.deploy", "service.status", "service.url"],
    spec: {
      name,
      image,
      ports: [{ port, public: true, protocol: "http" }],
      env: options.env,
      resources: {
        memoryMb: options.memoryMb,
        cpu: options.cpu
      },
      scale:
        options.minScale !== undefined || options.maxScale !== undefined
          ? {
              min: options.minScale,
              max: options.maxScale
            }
          : undefined,
      labels: { ...options.labels, "capsule.io/preset": "fly-http-service" },
      providerOptions: providerOptions({
        region: options.region
      })
    },
    notes: [
      "Models a Fly-hosted HTTP service for providers/adapters that expose service semantics.",
      "The current Fly adapter is machine-first, so callers should check service.deploy before using this preset."
    ]
  };
}

export interface VercelWebPresetOptions {
  name: string;
  sourcePath: string;
  entrypoint?: string;
  project?: string;
  target?: "production" | "staging" | "preview" | string;
  env?: Record<string, string>;
  routes?: string[];
  labels?: Record<string, string>;
}

export function vercelWebPreset(options: VercelWebPresetOptions): CapsulePreset<DeployEdgeSpec> {
  const name = requireNonEmptyString(options.name, "vercel-web name");
  const sourcePath = requireNonEmptyString(options.sourcePath, "vercel-web sourcePath");

  return {
    name: "vercel-web",
    domain: "edge",
    capabilityPaths: ["edge.deploy", "edge.status", "edge.release", "edge.url"],
    spec: {
      name,
      source: {
        path: sourcePath,
        entrypoint: options.entrypoint
      },
      runtime: "edge",
      env: options.env,
      routes: options.routes,
      labels: { ...options.labels, "capsule.io/preset": "vercel-web" },
      providerOptions: providerOptions({
        project: options.project,
        target: options.target ?? "preview"
      })
    },
    notes: [
      "Targets Vercel deployment-style edge/web runtimes through @capsule/adapter-vercel.",
      "Project linking, build settings, aliases, environment variables, and framework output remain Vercel-specific."
    ]
  };
}

export interface CloudflareWorkerPresetOptions {
  name: string;
  sourcePath: string;
  entrypoint?: string;
  env?: Record<string, string>;
  routes?: string[];
  labels?: Record<string, string>;
}

export function cloudflareWorkerPreset(options: CloudflareWorkerPresetOptions): CapsulePreset<DeployEdgeSpec> {
  const name = requireNonEmptyString(options.name, "cloudflare-worker name");
  const sourcePath = requireNonEmptyString(options.sourcePath, "cloudflare-worker sourcePath");

  return {
    name: "cloudflare-worker",
    domain: "edge",
    capabilityPaths: ["edge.deploy", "edge.version", "edge.rollback", "edge.routes"],
    spec: {
      name,
      source: {
        path: sourcePath,
        entrypoint: options.entrypoint
      },
      runtime: "workers",
      env: options.env,
      routes: options.routes,
      labels: { ...options.labels, "capsule.io/preset": "cloudflare-worker" }
    },
    notes: [
      "Targets Cloudflare Workers through @capsule/adapter-cloudflare.",
      "Bindings, routes, compatibility dates, secrets, and account/zone configuration remain Cloudflare-specific."
    ]
  };
}

export interface NeonPreviewBranchPresetOptions {
  project: string;
  name: string;
  parent?: string;
  ttlMs?: number;
  databaseName?: string;
  roleName?: string;
  pooled?: boolean;
  labels?: Record<string, string>;
}

export function neonPreviewBranchPreset(options: NeonPreviewBranchPresetOptions): CapsulePreset<CreateDatabaseBranchSpec> {
  const project = requireNonEmptyString(options.project, "neon-preview-branch project");
  const name = requireNonEmptyString(options.name, "neon-preview-branch name");
  validatePositiveNumber(options.ttlMs, "neon-preview-branch ttlMs");

  return {
    name: "neon-preview-branch",
    domain: "database",
    capabilityPaths: ["database.branchCreate", "database.connectionString", "database.branchDelete"],
    spec: {
      project,
      name,
      parent: options.parent,
      ttlMs: options.ttlMs,
      labels: { ...options.labels, "capsule.io/preset": "neon-preview-branch" },
      providerOptions: providerOptions({
        databaseName: options.databaseName,
        roleName: options.roleName,
        pooled: options.pooled
      })
    },
    policy: options.ttlMs ? { ttl: { maxMs: options.ttlMs } } : undefined,
    notes: [
      "Targets Neon branching through @capsule/adapter-neon.",
      "Connection roles, pooling, migrations, endpoint lifecycle, and branch cleanup remain explicit."
    ]
  };
}

export interface ProviderPreviewPresetOptions {
  name: string;
  source?: CreatePreviewSpec["source"];
  ttlMs?: number;
  web?: VercelWebPresetOptions;
  api?: FlyHttpServicePresetOptions;
  database?: NeonPreviewBranchPresetOptions;
  checks?: RunJobSpec[];
  labels?: Record<string, string>;
  policy?: CapsulePolicy;
}

export interface ProviderPreviewPreset {
  name: string;
  preview: CapsulePreset<CreatePreviewSpec>;
  components: {
    web?: CapsulePreset<DeployEdgeSpec>;
    api?: CapsulePreset<DeployServiceSpec>;
    database?: CapsulePreset<CreateDatabaseBranchSpec>;
    checks: Array<CapsulePreset<RunJobSpec>>;
  };
  policy: CapsulePolicy;
}

export function flyVercelNeonPreviewPreset(options: ProviderPreviewPresetOptions): ProviderPreviewPreset {
  const name = requireNonEmptyString(options.name, "fly-vercel-neon-preview name");
  validatePositiveNumber(options.ttlMs, "fly-vercel-neon-preview ttlMs");
  const web = options.web ? vercelWebPreset(options.web) : undefined;
  const api = options.api ? flyHttpServicePreset(options.api) : undefined;
  const database = options.database ? neonPreviewBranchPreset(options.database) : undefined;
  const checks = (options.checks ?? []).map((spec, index): CapsulePreset<RunJobSpec> => ({
    name: `preview-check-${index + 1}`,
    domain: "job",
    capabilityPaths: ["job.run", "job.logs"],
    spec: {
      ...spec,
      labels: { ...spec.labels, "capsule.io/preset": "fly-vercel-neon-preview" }
    },
    notes: ["Runs a preview verification job; timeout, logs, artifacts, and cancellation support remain adapter-specific."]
  }));
  const policy =
    options.policy ??
    agentSafePolicy({ network: { mode: "allowlist", allowedHosts: ["*.fly.dev", "*.vercel.app", "*.neon.tech"] }, timeoutMs: 300_000 });
  validatePolicyCompatibility(policy);

  return {
    name: "fly-vercel-neon-preview",
    preview: {
      name: "fly-vercel-neon-preview",
      domain: "preview",
      capabilityPaths: [
        "preview.create",
        "preview.destroy",
        "preview.urls",
        ...(web ? web.capabilityPaths : []),
        ...(api ? api.capabilityPaths : []),
        ...(database ? database.capabilityPaths : []),
        ...checks.flatMap((check) => check.capabilityPaths)
      ],
      spec: {
        name,
        source: options.source,
        ttlMs: options.ttlMs,
        services: api ? [api.spec] : undefined,
        edges: web ? [web.spec] : undefined,
        databases: database ? [database.spec] : undefined,
        jobs: checks.map((check) => check.spec),
        labels: { ...options.labels, "capsule.io/preset": "fly-vercel-neon-preview" }
      },
      policy,
      notes: [
        "Composes a common preview shape: Fly-style API service, Vercel web/edge deployment, Neon branch, and optional check jobs.",
        "This preset does not execute or orchestrate providers; use Capsule adapters and @capsule/preview to run it with explicit receipts."
      ]
    },
    components: {
      web,
      api,
      database,
      checks
    },
    policy
  };
}
