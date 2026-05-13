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
  return {
    name: "fly-machine",
    domain: "machine",
    capabilityPaths: ["machine.create", "machine.status", "machine.start", "machine.stop", "machine.destroy"],
    spec: {
      name: options.name,
      image: options.image,
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
  return {
    name: "fly-http-service",
    domain: "service",
    capabilityPaths: ["service.deploy", "service.status", "service.url"],
    spec: {
      name: options.name,
      image: options.image,
      ports: [{ port: options.port ?? 8080, public: true, protocol: "http" }],
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
  return {
    name: "vercel-web",
    domain: "edge",
    capabilityPaths: ["edge.deploy", "edge.status", "edge.release", "edge.url"],
    spec: {
      name: options.name,
      source: {
        path: options.sourcePath,
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
  return {
    name: "cloudflare-worker",
    domain: "edge",
    capabilityPaths: ["edge.deploy", "edge.version", "edge.rollback", "edge.routes"],
    spec: {
      name: options.name,
      source: {
        path: options.sourcePath,
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
  return {
    name: "neon-preview-branch",
    domain: "database",
    capabilityPaths: ["database.branchCreate", "database.connectionString", "database.branchDelete"],
    spec: {
      project: options.project,
      name: options.name,
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
  const policy = options.policy ?? agentSafePolicy({ network: { mode: "allowlist" }, timeoutMs: 300_000 });

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
        name: options.name,
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
