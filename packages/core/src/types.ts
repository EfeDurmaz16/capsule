export type SupportLevel = "native" | "emulated" | "unsupported" | "experimental";

export type CapsuleDomain =
  | "sandbox"
  | "job"
  | "service"
  | "function"
  | "edge"
  | "database"
  | "machine"
  | "preview"
  | "resource";

export type ProviderOptionValue = string | number | boolean | null | ProviderOptionValue[] | { [key: string]: ProviderOptionValue };

export type ProviderOptions = Record<string, ProviderOptionValue>;

export interface CapabilityMap {
  sandbox?: {
    create: SupportLevel;
    exec: SupportLevel;
    fileRead: SupportLevel;
    fileWrite: SupportLevel;
    fileList: SupportLevel;
    upload?: SupportLevel;
    download?: SupportLevel;
    destroy: SupportLevel;
    snapshot?: SupportLevel;
    restore?: SupportLevel;
    exposePort?: SupportLevel;
    mountWorkspace?: SupportLevel;
    networkPolicy?: SupportLevel;
    filesystemPolicy?: SupportLevel;
    secretMounting?: SupportLevel;
    streamingLogs?: SupportLevel;
    artifacts?: SupportLevel;
  };
  job?: {
    run: SupportLevel;
    status: SupportLevel;
    cancel: SupportLevel;
    logs: SupportLevel;
    artifacts: SupportLevel;
    timeout: SupportLevel;
    env: SupportLevel;
    resources?: SupportLevel;
  };
  service?: {
    deploy: SupportLevel;
    update: SupportLevel;
    delete: SupportLevel;
    status: SupportLevel;
    logs: SupportLevel;
    url: SupportLevel;
    scale?: SupportLevel;
    rollback?: SupportLevel;
    domains?: SupportLevel;
    healthcheck?: SupportLevel;
    secrets?: SupportLevel;
  };
  edge?: {
    deploy: SupportLevel;
    status?: SupportLevel;
    version?: SupportLevel;
    release?: SupportLevel;
    rollback: SupportLevel;
    routes: SupportLevel;
    bindings?: SupportLevel;
    logs?: SupportLevel;
    url?: SupportLevel;
  };
  database?: {
    branchCreate: SupportLevel;
    branchDelete: SupportLevel;
    branchReset?: SupportLevel;
    connectionString: SupportLevel;
    migrate?: SupportLevel;
    snapshot?: SupportLevel;
    restore?: SupportLevel;
  };
  preview?: {
    create: SupportLevel;
    destroy: SupportLevel;
    status: SupportLevel;
    logs: SupportLevel;
    urls: SupportLevel;
    ttl?: SupportLevel;
    cleanup?: SupportLevel;
  };
  machine?: {
    create: SupportLevel;
    status?: SupportLevel;
    exec: SupportLevel;
    start: SupportLevel;
    stop: SupportLevel;
    destroy: SupportLevel;
    snapshot?: SupportLevel;
    volume?: SupportLevel;
    network?: SupportLevel;
  };
}

export interface CapsulePolicy {
  network?: {
    mode: "none" | "allowlist" | "all";
    allowedHosts?: string[];
  };
  filesystem?: {
    read?: string[];
    write?: string[];
  };
  secrets?: {
    allowed?: string[];
    redactFromLogs?: boolean;
  };
  limits?: {
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    memoryMb?: number;
    cpu?: number;
  };
  cost?: {
    maxUsd?: number;
  };
  ttl?: {
    maxMs?: number;
  };
  approvals?: {
    required?: boolean;
    reason?: string;
  };
}

export interface LogEntry {
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface Artifact {
  name: string;
  path?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
  url?: string;
}

export interface CapsuleReceipt {
  id: string;
  type:
    | "sandbox.create"
    | "sandbox.exec"
    | "sandbox.destroy"
    | "job.run"
    | "job.status"
    | "job.cancel"
    | "service.deploy"
    | "service.status"
    | "service.update"
    | "service.delete"
    | "edge.deploy"
    | "edge.status"
    | "edge.version"
    | "edge.release"
    | "edge.rollback"
    | "database.branch.create"
    | "database.branch.delete"
    | "database.branch.reset"
    | "database.migrate"
    | "preview.create"
    | "preview.destroy"
    | "machine.create"
    | "machine.status"
    | "machine.start"
    | "machine.stop"
    | "machine.exec"
    | "machine.destroy";
  provider: string;
  adapter: string;
  capabilityPath: string;
  supportLevel: SupportLevel;
  command?: string[];
  image?: string;
  source?: Record<string, unknown>;
  cwd?: string;
  providerOptions?: ProviderOptions;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode?: number;
  stdoutHash?: string;
  stderrHash?: string;
  artifactHashes?: string[];
  policy: {
    decision: "allowed" | "denied";
    applied: CapsulePolicy;
    notes?: string[];
  };
  resource?: {
    id?: string;
    name?: string;
    url?: string;
    status?: string;
  };
  metadata?: CapsuleReceiptMetadata;
  signature?: {
    algorithm: string;
    value: string;
    keyId?: string;
  };
}

export interface CapsuleReceiptMetadata extends Record<string, unknown> {
  providerRequestId?: string;
  idempotencyKey?: string;
  idempotencyScope?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  logs: LogEntry[];
  artifacts: Artifact[];
  receipt?: CapsuleReceipt;
}

export interface CreateSandboxSpec {
  image?: string;
  name?: string;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
  exposedPorts?: Array<{
    containerPort: number;
    hostPort?: number;
    protocol?: "tcp" | "udp";
    hostIp?: string;
  }>;
}

export interface SandboxHandle {
  id: string;
  provider: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExecSpec {
  command: string[] | string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  input?: string;
  providerOptions?: ProviderOptions;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "unknown";
  sizeBytes?: number;
}

export interface Sandbox {
  handle: SandboxHandle;
  exec(spec: ExecSpec): Promise<ExecResult>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listFiles(path: string): Promise<FileEntry[]>;
  destroy(): Promise<void>;
}

export interface RunJobSpec {
  name?: string;
  image: string;
  command?: string[] | string;
  env?: Record<string, string>;
  timeoutMs?: number;
  resources?: {
    cpu?: number;
    memoryMb?: number;
  };
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRun {
  id: string;
  provider: string;
  status: JobRunStatus;
  result?: ExecResult;
  receipt?: CapsuleReceipt;
}

export interface JobStatusSpec {
  id: string;
  providerOptions?: ProviderOptions;
}

export interface JobStatusResult {
  id: string;
  provider: string;
  status: JobRunStatus;
  result?: ExecResult;
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface CancelJobSpec {
  id: string;
  reason?: string;
  providerOptions?: ProviderOptions;
}

export interface CancelJobResult {
  id: string;
  provider: string;
  status: "cancelled" | "cancelling";
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface DeployServiceSpec {
  name: string;
  image?: string;
  source?: {
    path?: string;
    repo?: string;
    ref?: string;
  };
  ports?: Array<{
    port: number;
    public?: boolean;
    protocol?: "http" | "tcp";
  }>;
  env?: Record<string, string>;
  resources?: {
    cpu?: number;
    memoryMb?: number;
  };
  scale?: {
    min?: number;
    max?: number;
  };
  healthcheck?: {
    path?: string;
    command?: string[] | string;
  };
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface ServiceDeployment {
  id: string;
  provider: string;
  name: string;
  status: ServiceStatus;
  url?: string;
  receipt?: CapsuleReceipt;
}

export type ServiceStatus = "deploying" | "ready" | "failed" | "deleted";

export interface ServiceStatusSpec {
  id: string;
  providerOptions?: ProviderOptions;
}

export interface ServiceStatusResult {
  id: string;
  provider: string;
  name?: string;
  status: ServiceStatus;
  url?: string;
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface UpdateServiceSpec {
  id: string;
  image?: string;
  source?: {
    path?: string;
    repo?: string;
    ref?: string;
  };
  ports?: Array<{
    port: number;
    public?: boolean;
    protocol?: "http" | "tcp";
  }>;
  env?: Record<string, string>;
  resources?: {
    cpu?: number;
    memoryMb?: number;
  };
  scale?: {
    min?: number;
    max?: number;
  };
  healthcheck?: {
    path?: string;
    command?: string[] | string;
  };
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface DeleteServiceSpec {
  id: string;
  force?: boolean;
  reason?: string;
  providerOptions?: ProviderOptions;
}

export interface DeletedService {
  id: string;
  provider: string;
  name?: string;
  status: "deleted";
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface DeployEdgeSpec {
  name: string;
  source?: {
    path?: string;
    entrypoint?: string;
    repo?: string;
    ref?: string;
  };
  runtime?: "node" | "workers" | "edge" | "deno" | "bun";
  env?: Record<string, string>;
  routes?: string[];
  bindings?: Record<string, unknown>;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface EdgeDeployment {
  id: string;
  provider: string;
  name: string;
  status: "deploying" | "ready" | "failed" | "deleted";
  url?: string;
  receipt?: CapsuleReceipt;
}

export interface EdgeStatusSpec {
  id: string;
  providerOptions?: ProviderOptions;
}

export interface EdgeStatusResult {
  id: string;
  provider: string;
  name?: string;
  status: EdgeDeployment["status"];
  url?: string;
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface VersionEdgeSpec {
  deploymentId?: string;
  name: string;
  source?: DeployEdgeSpec["source"];
  runtime?: DeployEdgeSpec["runtime"];
  env?: Record<string, string>;
  bindings?: Record<string, unknown>;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface EdgeVersion {
  id: string;
  provider: string;
  name: string;
  deploymentId?: string;
  status: "created" | "building" | "ready" | "failed";
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface ReleaseEdgeVersionSpec {
  versionId: string;
  deploymentId?: string;
  alias?: string;
  redirect?: string | null;
  routes?: string[];
  traffic?: number;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface EdgeRelease {
  id: string;
  provider: string;
  versionId: string;
  deploymentId?: string;
  alias?: string;
  status: "releasing" | "ready" | "failed";
  url?: string;
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface RollbackEdgeSpec {
  deploymentId: string;
  targetVersionId?: string;
  reason?: string;
  providerOptions?: ProviderOptions;
}

export interface EdgeRollback {
  id: string;
  provider: string;
  deploymentId: string;
  targetVersionId?: string;
  status: "rolling_back" | "ready" | "failed";
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface CreateDatabaseBranchSpec {
  project: string;
  parent?: string;
  name: string;
  ttlMs?: number;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface DeleteDatabaseBranchSpec {
  project: string;
  branchId: string;
  hardDelete?: boolean;
  providerOptions?: ProviderOptions;
}

export interface ResetDatabaseBranchSpec {
  project: string;
  branchId: string;
  sourceBranchId?: string;
  sourceLsn?: string;
  preserveUnderName?: string;
  parent?: string;
  pointInTime?: string;
  reason?: string;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface MigrateDatabaseSpec {
  project: string;
  branchId: string;
  command?: string[] | string;
  migrations?: Array<{
    id?: string;
    name?: string;
    sql?: string;
    path?: string;
  }>;
  dryRun?: boolean;
  env?: Record<string, string>;
  timeoutMs?: number;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface DatabaseBranch {
  id: string;
  provider: string;
  project: string;
  name: string;
  parent?: string;
  connectionString?: string;
  status: "creating" | "ready" | "failed" | "deleted";
  receipt?: CapsuleReceipt;
}

export interface DeletedDatabaseBranch {
  id: string;
  provider: string;
  project: string;
  status: "deleted";
  receipt?: CapsuleReceipt;
}

export interface ResetDatabaseBranch {
  id: string;
  provider: string;
  project: string;
  parent?: string;
  status: "resetting" | "ready" | "failed";
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface DatabaseMigration {
  id: string;
  provider: string;
  project: string;
  branchId: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  logs?: LogEntry[];
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface CreatePreviewSpec {
  name: string;
  source?: {
    repo?: string;
    ref?: string;
    path?: string;
  };
  ttlMs?: number;
  services?: DeployServiceSpec[];
  edges?: DeployEdgeSpec[];
  databases?: CreateDatabaseBranchSpec[];
  jobs?: RunJobSpec[];
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface PreviewEnvironment {
  id: string;
  provider: string;
  name: string;
  status: "creating" | "ready" | "failed" | "deleted";
  urls: string[];
  resources: Array<{
    type: CapsuleDomain;
    id: string;
    provider: string;
    name?: string;
  }>;
  receipt?: CapsuleReceipt;
}

export interface CreateMachineSpec {
  name: string;
  image?: string;
  region?: string;
  size?: string;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  providerOptions?: ProviderOptions;
}

export interface Machine {
  id: string;
  provider: string;
  name: string;
  status: "creating" | "running" | "stopped" | "failed" | "deleted";
  receipt?: CapsuleReceipt;
}

export interface MachineStatusSpec {
  id: string;
  providerOptions?: ProviderOptions;
}

export interface MachineStatusResult {
  id: string;
  provider: string;
  name?: string;
  status: Machine["status"];
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}

export interface StartMachineSpec {
  id: string;
  reason?: string;
  providerOptions?: ProviderOptions;
}

export interface StopMachineSpec {
  id: string;
  force?: boolean;
  reason?: string;
  providerOptions?: ProviderOptions;
}

export interface DestroyMachineSpec {
  id: string;
  force?: boolean;
  reason?: string;
  providerOptions?: ProviderOptions;
}

export interface MachineLifecycleResult {
  id: string;
  provider: string;
  status: "running" | "stopped" | "deleted" | "stopping" | "starting" | "destroying";
  receipt?: CapsuleReceipt;
  metadata?: Record<string, unknown>;
}
