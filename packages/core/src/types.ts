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
    | "service.deploy"
    | "edge.deploy"
    | "database.branch.create"
    | "database.branch.delete"
    | "preview.create"
    | "preview.destroy"
    | "machine.create"
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
  metadata?: Record<string, unknown>;
  signature?: {
    algorithm: string;
    value: string;
    keyId?: string;
  };
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
}

export interface JobRun {
  id: string;
  provider: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result?: ExecResult;
  receipt?: CapsuleReceipt;
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
}

export interface ServiceDeployment {
  id: string;
  provider: string;
  name: string;
  status: "deploying" | "ready" | "failed" | "deleted";
  url?: string;
  receipt?: CapsuleReceipt;
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
}

export interface EdgeDeployment {
  id: string;
  provider: string;
  name: string;
  status: "deploying" | "ready" | "failed" | "deleted";
  url?: string;
  receipt?: CapsuleReceipt;
}

export interface CreateDatabaseBranchSpec {
  project: string;
  parent?: string;
  name: string;
  ttlMs?: number;
  labels?: Record<string, string>;
}

export interface DeleteDatabaseBranchSpec {
  project: string;
  branchId: string;
  hardDelete?: boolean;
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
}

export interface Machine {
  id: string;
  provider: string;
  name: string;
  status: "creating" | "running" | "stopped" | "failed" | "deleted";
  receipt?: CapsuleReceipt;
}
