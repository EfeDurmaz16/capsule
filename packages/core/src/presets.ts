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
  validatePositiveNumber(options.timeoutMs, "agent-safe timeoutMs");
  validatePositiveNumber(options.memoryMb, "agent-safe memoryMb");
  validatePositiveNumber(options.cpu, "agent-safe cpu");
  const network = options.network ?? { mode: "none" };
  validatePresetPolicy({ network });
  const secretEnv = options.secretEnv ?? [];
  return {
    network,
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
  validateCommand(options.command, "node-job command");
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
  const name = requireNonEmptyString(options.name, "http-service name");
  requireImageOrSource(options.image, options.source, "http-service");
  const port = validatePort(options.port ?? 8080, "http-service port");
  validateScale(options.minScale, options.maxScale, "http-service");

  return {
    name: "http-service",
    domain: "service",
    capabilityPaths: ["service.deploy", "service.status", "service.url"],
    spec: {
      name,
      image: options.image,
      source: options.source,
      ports: [{ port, public: true, protocol: "http" }],
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
  const name = requireNonEmptyString(options.name, "edge-worker name");
  validateOptionalSource(options.source, "edge-worker source");

  return {
    name: "edge-worker",
    domain: "edge",
    capabilityPaths: ["edge.deploy", "edge.routes"],
    spec: {
      name,
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
  const project = requireNonEmptyString(options.project, "preview-database-branch project");
  const name = requireNonEmptyString(options.name, "preview-database-branch name");
  validatePositiveNumber(options.ttlMs, "preview-database-branch ttlMs");

  return {
    name: "preview-database-branch",
    domain: "database",
    capabilityPaths: ["database.branchCreate", "database.connectionString"],
    spec: {
      project,
      name,
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
  const name = requireNonEmptyString(options.name, "preview-environment name");
  validatePositiveNumber(options.ttlMs, "preview-environment ttlMs");

  return {
    name: "preview-environment",
    domain: "preview",
    capabilityPaths: ["preview.create", "preview.destroy", "preview.urls"],
    spec: {
      name,
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

function requireNonEmptyString(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCommand(command: string[] | string, field: string): void {
  if (typeof command === "string") {
    requireNonEmptyString(command, field);
    return;
  }
  if (!Array.isArray(command) || command.length === 0 || !command.every(isNonEmptyString)) {
    throw new TypeError(`${field} is required`);
  }
}

function validatePositiveNumber(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${field} must be greater than 0`);
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

function validateNonNegativeInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new RangeError(`${field} must be greater than or equal to 0`);
  }
}

function requireImageOrSource(image: string | undefined, source: DeployServiceSpec["source"] | undefined, preset: string): void {
  if (!isNonEmptyString(image) && !hasSourceLocator(source)) {
    throw new TypeError(`${preset} requires image or source`);
  }
}

function validateOptionalSource(source: DeployEdgeSpec["source"] | undefined, field: string): void {
  if (source !== undefined && !hasSourceLocator(source)) {
    throw new TypeError(`${field} requires path or repo`);
  }
}

function hasSourceLocator(source: DeployServiceSpec["source"] | DeployEdgeSpec["source"] | undefined): boolean {
  return isNonEmptyString(source?.path) || isNonEmptyString(source?.repo);
}

function validatePresetPolicy(policy: CapsulePolicy): void {
  if (policy.network?.mode === "allowlist" && !(policy.network.allowedHosts ?? []).some(isNonEmptyString)) {
    throw new TypeError("network allowlist requires at least one allowed host");
  }
}
