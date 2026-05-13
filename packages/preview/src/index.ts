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
import { createReceipt } from "@capsule/core";

export type PreviewResourceKind = "database" | "service" | "edge" | "job";
export type PreviewCleanupDisposition = "cleaned" | "partial" | "unsupported" | "leaked";

export interface PreviewCleanupDispositionRecord {
  resource: PreviewResourceRecord;
  disposition: PreviewCleanupDisposition;
  receipt?: CapsuleReceipt;
  error?: string;
  notes?: string[];
}

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
  cleanupDisposition?: PreviewCleanupDisposition;
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
  dispositions: PreviewCleanupDispositionRecord[];
  receipts: CapsuleReceipt[];
  receipt: CapsuleReceipt;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneWithDisposition(resource: PreviewResourceRecord, disposition: PreviewCleanupDisposition): PreviewResourceRecord {
  return {
    ...resource,
    cleanupDisposition: disposition
  };
}

function dispositionFromReceipt(receipt: CapsuleReceipt | undefined): PreviewCleanupDisposition {
  if (!receipt?.resource?.status) {
    return "cleaned";
  }
  return receipt.resource.status === "deleted" ? "cleaned" : "partial";
}

function createCleanupReceipt(
  preview: PreviewEnvironment,
  status: PreviewCleanupResult["status"],
  dispositions: PreviewCleanupDispositionRecord[],
  startedAt: Date
): CapsuleReceipt {
  return createReceipt({
    type: "preview.cleanup",
    provider: "capsule-preview",
    adapter: "@capsule/preview",
    capabilityPath: "preview.cleanup",
    supportLevel: "emulated",
    startedAt,
    resource: {
      id: preview.id,
      name: preview.name,
      status
    },
    metadata: {
      cleanupStatus: status,
      resources: dispositions.map((entry) => ({
        id: entry.resource.id,
        kind: entry.resource.kind,
        provider: entry.resource.provider,
        name: entry.resource.name,
        disposition: entry.disposition,
        receiptId: entry.receipt?.id,
        error: entry.error,
        notes: entry.notes
      }))
    },
    policy: {
      decision: "allowed",
      applied: {},
      notes: [
        "Preview cleanup receipt is emitted by @capsule/preview orchestration.",
        "Provider cleanup evidence is limited to the receipts returned by each resource adapter."
      ]
    }
  });
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
  const startedAt = new Date();
  const cleaned: PreviewResourceRecord[] = [];
  const failed: PreviewCleanupResult["failed"] = [];
  const receipts: CapsuleReceipt[] = [];
  const dispositions: PreviewCleanupDispositionRecord[] = [];

  for (const resource of [...resources].reverse()) {
    if (!resource.cleanup) {
      const unsupported = cloneWithDisposition(resource, "unsupported");
      dispositions.push({
        resource: unsupported,
        disposition: "unsupported",
        notes: ["No cleanup action is available for this preview resource."]
      });
      continue;
    }
    try {
      let receipt: CapsuleReceipt | undefined;
      if (resource.cleanup.kind === "database") {
        const result = await resource.cleanup.capsule.database.branch.delete(resource.cleanup.spec as { project: string; branchId: string; hardDelete?: boolean });
        receipt = result.receipt;
      } else if (resource.cleanup.kind === "service") {
        const result = await resource.cleanup.capsule.service.delete(resource.cleanup.spec as { id: string; name?: string });
        receipt = result.receipt;
      }
      if (receipt) receipts.push(receipt);
      const disposition = dispositionFromReceipt(receipt);
      const cleanedResource = cloneWithDisposition(resource, disposition);
      cleaned.push(cleanedResource);
      dispositions.push({ resource: cleanedResource, disposition, receipt });
    } catch (error) {
      const leakedResource = cloneWithDisposition(resource, "leaked");
      failed.push({ resource: leakedResource, error });
      dispositions.push({
        resource: leakedResource,
        disposition: "leaked",
        error: errorMessage(error),
        notes: ["Cleanup was attempted and failed; the resource may still exist at the provider."]
      });
    }
  }

  const status = dispositions.every((entry) => entry.disposition === "cleaned") ? "cleaned" : "partial";
  const receipt = createCleanupReceipt(preview, status, dispositions, startedAt);
  return {
    previewId: preview.id,
    status,
    cleaned,
    failed,
    dispositions,
    receipts: [...receipts, receipt],
    receipt
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
