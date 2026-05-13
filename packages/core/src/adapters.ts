import type {
  CapabilityMap,
  CapsulePolicy,
  CapsuleReceipt,
  CancelJobResult,
  CancelJobSpec,
  CreateDatabaseBranchSpec,
  DatabaseMigration,
  DeletedDatabaseBranch,
  DeleteDatabaseBranchSpec,
  DeletedService,
  CreateMachineSpec,
  CleanupPreviewSpec,
  DestroyMachineSpec,
  DestroyPreviewResult,
  DestroyPreviewSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DatabaseBranch,
  DeployEdgeSpec,
  DeployServiceSpec,
  EdgeRelease,
  EdgeRollback,
  EdgeLogsResult,
  EdgeLogsSpec,
  EdgeStatusResult,
  EdgeStatusSpec,
  EdgeVersion,
  EdgeDeployment,
  JobLogsResult,
  JobLogsSpec,
  JobRun,
  JobStatusResult,
  JobStatusSpec,
  Machine,
  MachineLifecycleResult,
  MachineStatusResult,
  MachineStatusSpec,
  MigrateDatabaseSpec,
  PreviewEnvironment,
  PreviewCleanupResult,
  PreviewLogsResult,
  PreviewLogsSpec,
  PreviewStatusResult,
  PreviewStatusSpec,
  PreviewUrlsResult,
  PreviewUrlsSpec,
  ResetDatabaseBranch,
  ResetDatabaseBranchSpec,
  RunJobSpec,
  Sandbox,
  ServiceDeployment,
  ServiceLogsResult,
  ServiceLogsSpec,
  RollbackServiceSpec,
  ServiceStatusResult,
  ServiceStatusSpec,
  StartMachineSpec,
  StopMachineSpec,
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
  logs?(spec: JobLogsSpec, context: AdapterContext): Promise<JobLogsResult>;
}

export interface ServiceAdapter {
  deploy(spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment>;
  status?(spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult>;
  update?(spec: UpdateServiceSpec, context: AdapterContext): Promise<ServiceDeployment>;
  rollback?(spec: RollbackServiceSpec, context: AdapterContext): Promise<ServiceDeployment>;
  delete?(spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService>;
  logs?(spec: ServiceLogsSpec, context: AdapterContext): Promise<ServiceLogsResult>;
}

export interface EdgeAdapter {
  deploy(spec: DeployEdgeSpec, context: AdapterContext): Promise<EdgeDeployment>;
  status?(spec: EdgeStatusSpec, context: AdapterContext): Promise<EdgeStatusResult>;
  version?(spec: VersionEdgeSpec, context: AdapterContext): Promise<EdgeVersion>;
  release?(spec: ReleaseEdgeVersionSpec, context: AdapterContext): Promise<EdgeRelease>;
  rollback?(spec: RollbackEdgeSpec, context: AdapterContext): Promise<EdgeRollback>;
  logs?(spec: EdgeLogsSpec, context: AdapterContext): Promise<EdgeLogsResult>;
}

export interface DatabaseBranchAdapter {
  create(spec: CreateDatabaseBranchSpec, context: AdapterContext): Promise<DatabaseBranch>;
  delete?(spec: DeleteDatabaseBranchSpec, context: AdapterContext): Promise<DeletedDatabaseBranch>;
  reset?(spec: ResetDatabaseBranchSpec, context: AdapterContext): Promise<ResetDatabaseBranch>;
}

export interface DatabaseAdapter {
  branch: DatabaseBranchAdapter;
  migrate?(spec: MigrateDatabaseSpec, context: AdapterContext): Promise<DatabaseMigration>;
}

export interface PreviewAdapter {
  create(spec: CreatePreviewSpec, context: AdapterContext): Promise<PreviewEnvironment>;
  destroy?(spec: DestroyPreviewSpec, context: AdapterContext): Promise<DestroyPreviewResult>;
  status?(spec: PreviewStatusSpec, context: AdapterContext): Promise<PreviewStatusResult>;
  logs?(spec: PreviewLogsSpec, context: AdapterContext): Promise<PreviewLogsResult>;
  urls?(spec: PreviewUrlsSpec, context: AdapterContext): Promise<PreviewUrlsResult>;
  cleanup?(spec: CleanupPreviewSpec, context: AdapterContext): Promise<PreviewCleanupResult>;
}

export interface MachineAdapter {
  create(spec: CreateMachineSpec, context: AdapterContext): Promise<Machine>;
  status?(spec: MachineStatusSpec, context: AdapterContext): Promise<MachineStatusResult>;
  start?(spec: StartMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult>;
  stop?(spec: StopMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult>;
  destroy?(spec: DestroyMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult>;
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
