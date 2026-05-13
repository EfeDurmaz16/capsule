import type {
  Capsule,
  CapsuleDomain,
  CapsuleReceipt,
  CreateDatabaseBranchSpec,
  CreatePreviewSpec,
  DatabaseBranch,
  DeployEdgeSpec,
  DeployServiceSpec,
  EdgeDeployment,
  ExecResult,
  JobRun,
  PreviewEnvironment,
  RunJobSpec,
  ServiceDeployment
} from "@capsule/core";

export type PreviewResourceKind = "database" | "service" | "edge" | "job";

export interface PreviewResourceRecord {
  type: CapsuleDomain;
  kind: PreviewResourceKind;
  id: string;
  provider: string;
  name?: string;
  url?: string;
  status?: string;
  receipt?: CapsuleReceipt;
  cleanup?: PreviewCleanupAction;
}

export interface PreviewCleanupAction {
  kind: PreviewResourceKind;
  capsule: Capsule;
  spec: Record<string, unknown>;
  capabilityPath: string;
}

export interface PreviewResourceGroup<TSpec> {
  capsule: Capsule;
  spec: TSpec;
}

export interface PreviewPlan {
  name: string;
  source?: CreatePreviewSpec["source"];
  ttlMs?: number;
  databases?: Array<PreviewResourceGroup<CreateDatabaseBranchSpec>>;
  services?: Array<PreviewResourceGroup<DeployServiceSpec>>;
  edges?: Array<PreviewResourceGroup<DeployEdgeSpec>>;
  jobs?: Array<PreviewResourceGroup<RunJobSpec>>;
  labels?: Record<string, string>;
}

export interface PreviewCleanupResult {
  previewId: string;
  status: "cleaned" | "partial";
  cleaned: PreviewResourceRecord[];
  failed: Array<{
    resource: PreviewResourceRecord;
    error: unknown;
  }>;
  receipts: CapsuleReceipt[];
}

export interface PreviewOrchestrationResult {
  preview: PreviewEnvironment;
  resources: PreviewResourceRecord[];
  receipts: CapsuleReceipt[];
}

export class PreviewCreationError extends Error {
  readonly preview: PreviewEnvironment;
  readonly cleanup?: PreviewCleanupResult;
  readonly cause: unknown;

  constructor(message: string, options: { preview: PreviewEnvironment; cleanup?: PreviewCleanupResult; cause: unknown }) {
    super(message);
    this.name = "PreviewCreationError";
    this.preview = options.preview;
    this.cleanup = options.cleanup;
    this.cause = options.cause;
  }
}

export function createPreviewId(name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preview";
  return `preview_${safeName}_${Date.now().toString(36)}`;
}

function receiptOf(value: { receipt?: CapsuleReceipt } | undefined): CapsuleReceipt | undefined {
  return value?.receipt;
}

function serviceRecord(resource: ServiceDeployment, capsule: Capsule): PreviewResourceRecord {
  return {
    type: "service",
    kind: "service",
    id: resource.id,
    provider: resource.provider,
    name: resource.name,
    url: resource.url,
    status: resource.status,
    receipt: resource.receipt,
    cleanup: {
      kind: "service",
      capsule,
      capabilityPath: "service.delete",
      spec: { id: resource.id, name: resource.name }
    }
  };
}

function edgeRecord(resource: EdgeDeployment): PreviewResourceRecord {
  return {
    type: "edge",
    kind: "edge",
    id: resource.id,
    provider: resource.provider,
    name: resource.name,
    url: resource.url,
    status: resource.status,
    receipt: resource.receipt
  };
}

function databaseRecord(resource: DatabaseBranch, capsule: Capsule): PreviewResourceRecord {
  return {
    type: "database",
    kind: "database",
    id: resource.id,
    provider: resource.provider,
    name: resource.name,
    status: resource.status,
    receipt: resource.receipt,
    cleanup: {
      kind: "database",
      capsule,
      capabilityPath: "database.branchDelete",
      spec: { project: resource.project, branchId: resource.id }
    }
  };
}

function jobRecord(resource: JobRun): PreviewResourceRecord {
  return {
    type: "job",
    kind: "job",
    id: resource.id,
    provider: resource.provider,
    status: resource.status,
    receipt: resource.receipt ?? receiptOf(resource.result)
  };
}

function previewFromResources(id: string, plan: PreviewPlan, status: PreviewEnvironment["status"], resources: PreviewResourceRecord[]): PreviewEnvironment {
  return {
    id,
    provider: "capsule-preview",
    name: plan.name,
    status,
    urls: resources.map((resource) => resource.url).filter((url): url is string => typeof url === "string"),
    resources: resources.map((resource) => ({
      type: resource.type,
      id: resource.id,
      provider: resource.provider,
      name: resource.name
    }))
  };
}

export async function createPreviewEnvironment(plan: PreviewPlan): Promise<PreviewEnvironment> {
  return (await createPreviewGraph(plan)).preview;
}

export async function createPreviewGraph(plan: PreviewPlan): Promise<PreviewOrchestrationResult> {
  const id = createPreviewId(plan.name);
  const resources: PreviewResourceRecord[] = [];

  try {
    for (const entry of plan.databases ?? []) {
      resources.push(databaseRecord(await entry.capsule.database.branch.create(entry.spec), entry.capsule));
    }
    for (const entry of plan.services ?? []) {
      resources.push(serviceRecord(await entry.capsule.service.deploy(entry.spec), entry.capsule));
    }
    for (const entry of plan.edges ?? []) {
      resources.push(edgeRecord(await entry.capsule.edge.deploy(entry.spec)));
    }
    for (const entry of plan.jobs ?? []) {
      resources.push(jobRecord(await entry.capsule.job.run(entry.spec)));
    }

    return {
      preview: previewFromResources(id, plan, "ready", resources),
      resources,
      receipts: resources.map((resource) => resource.receipt).filter((receipt): receipt is CapsuleReceipt => receipt !== undefined)
    };
  } catch (error) {
    const failedPreview = previewFromResources(id, plan, "failed", resources);
    throw new PreviewCreationError("Preview environment creation failed.", { preview: failedPreview, cause: error });
  }
}

export async function cleanupPreviewEnvironment(preview: PreviewEnvironment, resources: PreviewResourceRecord[]): Promise<PreviewCleanupResult> {
  const cleaned: PreviewResourceRecord[] = [];
  const failed: PreviewCleanupResult["failed"] = [];
  const receipts: CapsuleReceipt[] = [];

  for (const resource of [...resources].reverse()) {
    if (!resource.cleanup) continue;
    try {
      if (resource.cleanup.kind === "database") {
        const result = await resource.cleanup.capsule.database.branch.delete(resource.cleanup.spec as { project: string; branchId: string; hardDelete?: boolean });
        if (result.receipt) receipts.push(result.receipt);
      } else if (resource.cleanup.kind === "service") {
        const result = await resource.cleanup.capsule.service.delete(resource.cleanup.spec as { id: string; name?: string });
        if (result.receipt) receipts.push(result.receipt);
      }
      cleaned.push(resource);
    } catch (error) {
      failed.push({ resource, error });
    }
  }

  return {
    previewId: preview.id,
    status: failed.length > 0 ? "partial" : "cleaned",
    cleaned,
    failed,
    receipts
  };
}

export async function createPreviewEnvironmentWithCleanup(plan: PreviewPlan): Promise<PreviewEnvironment> {
  const id = createPreviewId(plan.name);
  const resources: PreviewResourceRecord[] = [];

  try {
    for (const entry of plan.databases ?? []) {
      resources.push(databaseRecord(await entry.capsule.database.branch.create(entry.spec), entry.capsule));
    }
    for (const entry of plan.services ?? []) {
      resources.push(serviceRecord(await entry.capsule.service.deploy(entry.spec), entry.capsule));
    }
    for (const entry of plan.edges ?? []) {
      resources.push(edgeRecord(await entry.capsule.edge.deploy(entry.spec)));
    }
    for (const entry of plan.jobs ?? []) {
      resources.push(jobRecord(await entry.capsule.job.run(entry.spec)));
    }
    return previewFromResources(id, plan, "ready", resources);
  } catch (error) {
    const failedPreview = previewFromResources(id, plan, "failed", resources);
    const cleanup = await cleanupPreviewEnvironment(failedPreview, resources);
    throw new PreviewCreationError("Preview environment creation failed and cleanup was attempted.", {
      preview: failedPreview,
      cleanup,
      cause: error
    });
  }
}
