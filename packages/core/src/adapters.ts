import type {
  CapabilityMap,
  CapsulePolicy,
  CapsuleReceipt,
  CancelJobResult,
  CancelJobSpec,
  CreateDatabaseBranchSpec,
  DeletedDatabaseBranch,
  DeleteDatabaseBranchSpec,
  CreateMachineSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DatabaseBranch,
  DeployEdgeSpec,
  DeployServiceSpec,
  EdgeDeployment,
  JobRun,
  JobStatusResult,
  JobStatusSpec,
  Machine,
  PreviewEnvironment,
  RunJobSpec,
  Sandbox,
  ServiceDeployment
} from "./types.js";
import type { CreateReceiptInput } from "./receipts.js";
import type { PolicyDecision, PolicyInput } from "./policy.js";

export interface AdapterContext {
  receipts: boolean;
  policy: CapsulePolicy;
  supportLevel(path: string): import("./types.js").SupportLevel;
  evaluatePolicy(input?: PolicyInput): PolicyDecision;
  createReceipt(input: Omit<CreateReceiptInput, "provider" | "adapter" | "supportLevel"> & { supportLevel?: import("./types.js").SupportLevel }): CapsuleReceipt;
  recordReceipt(receipt: CapsuleReceipt): Promise<void>;
}

export interface SandboxAdapter {
  create(spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox>;
}

export interface JobAdapter {
  run(spec: RunJobSpec, context: AdapterContext): Promise<JobRun>;
  status?(spec: JobStatusSpec, context: AdapterContext): Promise<JobStatusResult>;
  cancel?(spec: CancelJobSpec, context: AdapterContext): Promise<CancelJobResult>;
}

export interface ServiceAdapter {
  deploy(spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment>;
}

export interface EdgeAdapter {
  deploy(spec: DeployEdgeSpec, context: AdapterContext): Promise<EdgeDeployment>;
}

export interface DatabaseBranchAdapter {
  create(spec: CreateDatabaseBranchSpec, context: AdapterContext): Promise<DatabaseBranch>;
  delete?(spec: DeleteDatabaseBranchSpec, context: AdapterContext): Promise<DeletedDatabaseBranch>;
}

export interface DatabaseAdapter {
  branch: DatabaseBranchAdapter;
}

export interface PreviewAdapter {
  create(spec: CreatePreviewSpec, context: AdapterContext): Promise<PreviewEnvironment>;
}

export interface MachineAdapter {
  create(spec: CreateMachineSpec, context: AdapterContext): Promise<Machine>;
}

export interface CapsuleAdapter {
  name: string;
  provider: string;
  capabilities: CapabilityMap;
  raw?: unknown;
  sandbox?: SandboxAdapter;
  job?: JobAdapter;
  service?: ServiceAdapter;
  edge?: EdgeAdapter;
  database?: DatabaseAdapter;
  preview?: PreviewAdapter;
  machine?: MachineAdapter;
}
