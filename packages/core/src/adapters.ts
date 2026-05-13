import type {
  CapabilityMap,
  CapsulePolicy,
  CapsuleReceipt,
  CancelJobResult,
  CancelJobSpec,
  CreateDatabaseBranchSpec,
  DeletedDatabaseBranch,
  DeleteDatabaseBranchSpec,
  DeletedService,
  CreateMachineSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DatabaseBranch,
  DeployEdgeSpec,
  DeployServiceSpec,
  EdgeRelease,
  EdgeRollback,
  EdgeVersion,
  EdgeDeployment,
  JobRun,
  JobStatusResult,
  JobStatusSpec,
  Machine,
  PreviewEnvironment,
  RunJobSpec,
  Sandbox,
  ServiceDeployment,
  ServiceStatusResult,
  ServiceStatusSpec,
  UpdateServiceSpec,
  DeleteServiceSpec,
  ReleaseEdgeVersionSpec,
  RollbackEdgeSpec,
  VersionEdgeSpec
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
  status?(spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult>;
  update?(spec: UpdateServiceSpec, context: AdapterContext): Promise<ServiceDeployment>;
  delete?(spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService>;
}

export interface EdgeAdapter {
  deploy(spec: DeployEdgeSpec, context: AdapterContext): Promise<EdgeDeployment>;
  version?(spec: VersionEdgeSpec, context: AdapterContext): Promise<EdgeVersion>;
  release?(spec: ReleaseEdgeVersionSpec, context: AdapterContext): Promise<EdgeRelease>;
  rollback?(spec: RollbackEdgeSpec, context: AdapterContext): Promise<EdgeRollback>;
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
