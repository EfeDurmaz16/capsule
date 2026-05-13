import type { CapabilityPath } from "./capabilities.js";
import type {
  CapsuleDomain,
  CapsulePolicy,
  CreateDatabaseBranchSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DeployEdgeSpec,
  DeployServiceSpec,
  RunJobSpec
} from "./types.js";

export interface CapsulePreset<TSpec> {
  name: string;
  domain: CapsuleDomain;
  capabilityPaths: CapabilityPath[];
  spec: TSpec;
  policy?: CapsulePolicy;
  notes: string[];
}

export interface AgentSafePolicyOptions {
  timeoutMs?: number;
  network?: CapsulePolicy["network"];
  filesystem?: CapsulePolicy["filesystem"];
  secretEnv?: string[];
  redactSecrets?: boolean;
  memoryMb?: number;
  cpu?: number;
}

export function agentSafePolicy(options: AgentSafePolicyOptions = {}): CapsulePolicy {
  const secretEnv = options.secretEnv ?? [];
  return {
    network: options.network ?? { mode: "none" },
    filesystem: options.filesystem ?? { read: ["/workspace"], write: ["/workspace"] },
    secrets:
      secretEnv.length > 0 || options.redactSecrets
        ? {
            allowed: secretEnv,
            redactFromLogs: options.redactSecrets ?? true
          }
        : undefined,
    limits: {
      timeoutMs: options.timeoutMs ?? 60_000,
      memoryMb: options.memoryMb,
      cpu: options.cpu
    }
  };
}

export interface NodeSandboxPresetOptions {
  image?: string;
  name?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  labels?: Record<string, string>;
  secretEnv?: string[];
}

export function nodeSandboxPreset(options: NodeSandboxPresetOptions = {}): CapsulePreset<CreateSandboxSpec> {
  return {
    name: "node-sandbox",
    domain: "sandbox",
    capabilityPaths: ["sandbox.create", "sandbox.exec", "sandbox.fileWrite", "sandbox.destroy"],
    spec: {
      image: options.image ?? "node:22",
      name: options.name,
      cwd: options.cwd ?? "/workspace",
      env: options.env,
      timeoutMs: options.timeoutMs,
      labels: options.labels
    },
    policy: agentSafePolicy({ timeoutMs: options.timeoutMs, secretEnv: options.secretEnv }),
    notes: ["Creates a sandbox spec for Node.js execution; callers still need an adapter with sandbox support."]
  };
}

export interface NodeJobPresetOptions {
  image?: string;
  name?: string;
  command: string[] | string;
  env?: Record<string, string>;
  timeoutMs?: number;
  labels?: Record<string, string>;
  secretEnv?: string[];
}

export function nodeJobPreset(options: NodeJobPresetOptions): CapsulePreset<RunJobSpec> {
  return {
    name: "node-job",
    domain: "job",
    capabilityPaths: ["job.run"],
    spec: {
      image: options.image ?? "node:22",
      name: options.name,
      command: options.command,
      env: options.env,
      timeoutMs: options.timeoutMs,
      labels: options.labels
    },
    policy: agentSafePolicy({ timeoutMs: options.timeoutMs, secretEnv: options.secretEnv }),
    notes: ["Creates a one-shot Node.js job spec; timeout/resource enforcement depends on adapter support."]
  };
}

export interface HttpServicePresetOptions {
  name: string;
  image?: string;
  source?: DeployServiceSpec["source"];
  port?: number;
  env?: Record<string, string>;
  minScale?: number;
  maxScale?: number;
  healthPath?: string;
  labels?: Record<string, string>;
}

export function httpServicePreset(options: HttpServicePresetOptions): CapsulePreset<DeployServiceSpec> {
  return {
    name: "http-service",
    domain: "service",
    capabilityPaths: ["service.deploy", "service.status", "service.url"],
    spec: {
      name: options.name,
      image: options.image,
      source: options.source,
      ports: [{ port: options.port ?? 8080, public: true, protocol: "http" }],
      env: options.env,
      scale:
        options.minScale !== undefined || options.maxScale !== undefined
          ? {
              min: options.minScale,
              max: options.maxScale
            }
          : undefined,
      healthcheck: options.healthPath ? { path: options.healthPath } : undefined,
      labels: options.labels
    },
    notes: ["Models a public HTTP service; provider routing, domains, revisions, and scaling remain adapter-specific."]
  };
}

export interface EdgeWorkerPresetOptions {
  name: string;
  source?: DeployEdgeSpec["source"];
  runtime?: DeployEdgeSpec["runtime"];
  env?: Record<string, string>;
  routes?: string[];
  bindings?: Record<string, unknown>;
  labels?: Record<string, string>;
}

export function edgeWorkerPreset(options: EdgeWorkerPresetOptions): CapsulePreset<DeployEdgeSpec> {
  return {
    name: "edge-worker",
    domain: "edge",
    capabilityPaths: ["edge.deploy", "edge.routes"],
    spec: {
      name: options.name,
      source: options.source,
      runtime: options.runtime ?? "workers",
      env: options.env,
      routes: options.routes,
      bindings: options.bindings,
      labels: options.labels
    },
    notes: ["Models an edge runtime deployment; bindings, routes, versions, and releases vary by provider."]
  };
}

export interface PreviewDatabaseBranchPresetOptions {
  project: string;
  name: string;
  parent?: string;
  ttlMs?: number;
  labels?: Record<string, string>;
}

export function previewDatabaseBranchPreset(options: PreviewDatabaseBranchPresetOptions): CapsulePreset<CreateDatabaseBranchSpec> {
  return {
    name: "preview-database-branch",
    domain: "database",
    capabilityPaths: ["database.branchCreate", "database.connectionString"],
    spec: {
      project: options.project,
      name: options.name,
      parent: options.parent,
      ttlMs: options.ttlMs,
      labels: options.labels
    },
    policy: options.ttlMs ? { ttl: { maxMs: options.ttlMs } } : undefined,
    notes: ["Models an ephemeral database branch for previews; migrations and cleanup must be explicit."]
  };
}

export interface PreviewEnvironmentPresetOptions {
  name: string;
  source?: CreatePreviewSpec["source"];
  ttlMs?: number;
  services?: DeployServiceSpec[];
  edges?: DeployEdgeSpec[];
  databases?: CreateDatabaseBranchSpec[];
  jobs?: RunJobSpec[];
  labels?: Record<string, string>;
}

export function previewEnvironmentPreset(options: PreviewEnvironmentPresetOptions): CapsulePreset<CreatePreviewSpec> {
  return {
    name: "preview-environment",
    domain: "preview",
    capabilityPaths: ["preview.create", "preview.destroy", "preview.urls"],
    spec: {
      name: options.name,
      source: options.source,
      ttlMs: options.ttlMs,
      services: options.services,
      edges: options.edges,
      databases: options.databases,
      jobs: options.jobs,
      labels: options.labels
    },
    policy: options.ttlMs ? { ttl: { maxMs: options.ttlMs } } : undefined,
    notes: ["Composes preview resources; provider-specific orchestration and cleanup evidence stay visible in receipts."]
  };
}

