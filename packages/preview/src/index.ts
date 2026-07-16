import type {
  Capsule,
  CapsuleDomain,
  CapsuleReceipt,
  CapabilityPath,
  CapabilityRequirementResult,
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
import { createReceipt, evaluateCapabilityRequirements } from "@capsule/core";

export type PreviewResourceKind = "database" | "service" | "edge" | "job";
export type PreviewCleanupDisposition = "cleaned" | "partial" | "unsupported" | "leaked";
export type PreviewPlannedResourceSpec = CreateDatabaseBranchSpec | DeployServiceSpec | DeployEdgeSpec | RunJobSpec;
export const previewCleanupPlanSchema = "capsule.preview.cleanup.v1" as const;

export interface PreviewPlannedResource<TSpec extends PreviewPlannedResourceSpec = PreviewPlannedResourceSpec> {
  order: number;
  type: CapsuleDomain;
  kind: PreviewResourceKind;
  name?: string;
  capabilityPath: CapabilityPath;
  cleanupCapabilityPath?: CapabilityPath;
  spec: TSpec;
}

export interface PreviewCapabilityCheck {
  order: number;
  type: CapsuleDomain;
  kind: PreviewResourceKind;
  name?: string;
  capabilityPath: CapabilityPath;
  required: true;
  reason: string;
}

export interface PreviewCompiledPlan {
  name: string;
  source?: CreatePreviewSpec["source"];
  ttlMs?: number;
  labels?: Record<string, string>;
  providerOptions?: CreatePreviewSpec["providerOptions"];
  resources: PreviewPlannedResource[];
  checks: PreviewCapabilityCheck[];
}

export interface PreviewCapabilityValidationRecord {
  resource: PreviewPlannedResource;
  check: PreviewCapabilityCheck;
  adapter: string;
  provider: string;
  result: CapabilityRequirementResult;
}

export interface PreviewCapabilityValidationResult {
  ok: boolean;
  checked: PreviewCapabilityValidationRecord[];
  missingRequired: PreviewCapabilityValidationRecord[];
}

export interface PreviewDryRunReceiptBundle {
  plan: PreviewCompiledPlan;
  validation: PreviewCapabilityValidationResult;
  receipts: CapsuleReceipt[];
  receipt: CapsuleReceipt;
}

export interface CreatePreviewDryRunReceiptBundleOptions {
  startedAt?: Date;
}

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
  capabilityPath: CapabilityPath;
}

export interface PreviewCleanupPlanAction {
  actionId: string;
  cleanupOrder: number;
  kind: PreviewResourceKind;
  resourceId: string;
  resourceProvider: string;
  resourceName?: string;
  capabilityPath: CapabilityPath;
  spec: Record<string, unknown>;
  idempotencyKey: string;
  reversible: true;
}

export interface PreviewCleanupPlanResource {
  order: number;
  cleanupOrder?: number;
  type: CapsuleDomain;
  kind: PreviewResourceKind;
  id: string;
  provider: string;
  name?: string;
  url?: string;
  status?: string;
  receiptId?: string;
  cleanupCapabilityPath?: CapabilityPath;
  cleanupActionId?: string;
}

export interface PreviewCleanupPlan {
  schema: typeof previewCleanupPlanSchema;
  id: string;
  previewId: string;
  createdAt: string;
  cleanupOrder: "reverse-create-order";
  cleanupActionCount: number;
  unsupportedCleanupCount: number;
  resources: PreviewCleanupPlanResource[];
  actions: PreviewCleanupPlanAction[];
}

export interface CreatePreviewCleanupPlanOptions {
  createdAt?: Date;
}

export interface PreviewResourceGroup<TSpec> {
  capsule: Capsule;
  spec: TSpec;
}

export interface PreviewPlan {
  name: string;
  source?: CreatePreviewSpec["source"];
  ttlMs?: number;
  requireRealProviders?: boolean;
  allowMockProviders?: boolean;
  databases?: Array<PreviewResourceGroup<CreateDatabaseBranchSpec>>;
  services?: Array<PreviewResourceGroup<DeployServiceSpec>>;
  edges?: Array<PreviewResourceGroup<DeployEdgeSpec>>;
  jobs?: Array<PreviewResourceGroup<RunJobSpec>>;
  labels?: Record<string, string>;
}

export interface PreviewCleanupResult {
  previewId: string;
  status: "cleaned" | "unsupported" | "partial";
  cleaned: PreviewResourceRecord[];
  failed: Array<{
    resource: PreviewResourceRecord;
    error: unknown;
  }>;
  dispositions: PreviewCleanupDispositionRecord[];
  receipts: CapsuleReceipt[];
  receipt: CapsuleReceipt;
}

export interface CleanupPreviewEnvironmentOptions {
  cleanupPlan?: PreviewCleanupPlan;
  startedAt?: Date;
}

export interface PreviewOrchestrationResult {
  preview: PreviewEnvironment;
  resources: PreviewResourceRecord[];
  cleanupPlan: PreviewCleanupPlan;
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

export class MockProviderNotAllowedError extends Error {
  readonly provider: string;
  readonly adapter: string;

  constructor(provider: string, adapter: string) {
    super(`Preview plan requires real providers, but adapter ${adapter} for provider ${provider} is marked as mock.`);
    this.name = "MockProviderNotAllowedError";
    this.provider = provider;
    this.adapter = adapter;
  }
}

const previewResourceCapabilities: Record<PreviewResourceKind, { create: CapabilityPath; cleanup?: CapabilityPath; reason: string }> = {
  database: {
    create: "database.branchCreate",
    cleanup: "database.branchDelete",
    reason: "Preview database branches require database.branchCreate support."
  },
  service: {
    create: "service.deploy",
    cleanup: "service.delete",
    reason: "Preview services require service.deploy support."
  },
  edge: {
    create: "edge.deploy",
    reason: "Preview edge deployments require edge.deploy support."
  },
  job: {
    create: "job.run",
    reason: "Preview checks require job.run support."
  }
};

export function createPreviewId(name: string): string {
  const safeName =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "preview";
  return `preview_${safeName}_${Date.now().toString(36)}`;
}

export function compilePreviewSpec(spec: CreatePreviewSpec): PreviewCompiledPlan {
  const resources: PreviewPlannedResource[] = [];
  let order = 0;

  for (const database of spec.databases ?? []) {
    resources.push(plannedResource("database", order++, database.name, database));
  }
  for (const service of spec.services ?? []) {
    resources.push(plannedResource("service", order++, service.name, service));
  }
  for (const edge of spec.edges ?? []) {
    resources.push(plannedResource("edge", order++, edge.name, edge));
  }
  for (const job of spec.jobs ?? []) {
    resources.push(plannedResource("job", order++, job.name, job));
  }

  return {
    name: spec.name,
    source: spec.source,
    ttlMs: spec.ttlMs,
    labels: spec.labels,
    providerOptions: spec.providerOptions,
    resources,
    checks: resources.map((resource) => ({
      order: resource.order,
      type: resource.type,
      kind: resource.kind,
      name: resource.name,
      capabilityPath: resource.capabilityPath,
      required: true,
      reason: previewResourceCapabilities[resource.kind].reason
    }))
  };
}

export function compilePreviewPlan(plan: PreviewPlan): PreviewCompiledPlan {
  return compilePreviewSpec({
    name: plan.name,
    source: plan.source,
    ttlMs: plan.ttlMs,
    labels: plan.labels,
    databases: plan.databases?.map((entry) => entry.spec),
    services: plan.services?.map((entry) => entry.spec),
    edges: plan.edges?.map((entry) => entry.spec),
    jobs: plan.jobs?.map((entry) => entry.spec)
  });
}

export function validatePreviewPlanCapabilities(plan: PreviewPlan): PreviewCapabilityValidationResult {
  const checked: PreviewCapabilityValidationRecord[] = [];

  for (const entry of resourceGroups(plan)) {
    const resource = plannedResource(entry.kind, checked.length, resourceName(entry.spec), entry.spec);
    const check: PreviewCapabilityCheck = {
      order: resource.order,
      type: resource.type,
      kind: resource.kind,
      name: resource.name,
      capabilityPath: resource.capabilityPath,
      required: true,
      reason: previewResourceCapabilities[entry.kind].reason
    };
    const [result] = evaluateCapabilityRequirements(entry.capsule.capabilities(), [{ path: check.capabilityPath, reason: check.reason }]);
    checked.push({
      resource,
      check,
      adapter: entry.capsule.adapterName(),
      provider: String((entry.capsule.raw() as { provider?: unknown } | undefined)?.provider ?? "unknown"),
      result
    });
  }

  const missingRequired = checked.filter((record) => !record.result.supported);
  return {
    ok: missingRequired.length === 0,
    checked,
    missingRequired
  };
}

export function createPreviewDryRunReceiptBundle(plan: PreviewPlan, options: CreatePreviewDryRunReceiptBundleOptions = {}): PreviewDryRunReceiptBundle {
  const startedAt = options.startedAt ?? new Date();
  const compiledPlan = compilePreviewPlan(plan);
  const validation = validatePreviewPlanCapabilities(plan);
  const receipt = createReceipt({
    type: "preview.create",
    provider: "capsule-preview",
    adapter: "@capsule/preview",
    capabilityPath: "preview.create",
    supportLevel: "emulated",
    startedAt,
    resource: {
      id: `dry_run_${compiledPlan.name}`,
      name: compiledPlan.name,
      status: validation.ok ? "ready" : "failed"
    },
    metadata: {
      dryRun: true,
      source: compiledPlan.source,
      ttlMs: compiledPlan.ttlMs,
      labels: compiledPlan.labels,
      resources: compiledPlan.resources.map((resource) => ({
        order: resource.order,
        kind: resource.kind,
        name: resource.name,
        capabilityPath: resource.capabilityPath,
        cleanupCapabilityPath: resource.cleanupCapabilityPath
      })),
      capabilityChecks: validation.checked.map((record) => ({
        order: record.check.order,
        kind: record.check.kind,
        name: record.check.name,
        provider: record.provider,
        adapter: record.adapter,
        path: record.result.path,
        actualLevel: record.result.actualLevel,
        supported: record.result.supported,
        reason: record.result.reason
      })),
      missingRequired: validation.missingRequired.map((record) => ({
        kind: record.check.kind,
        name: record.check.name,
        provider: record.provider,
        adapter: record.adapter,
        path: record.result.path,
        actualLevel: record.result.actualLevel,
        reason: record.result.reason
      }))
    },
    policy: {
      decision: validation.ok ? "allowed" : "denied",
      applied: {},
      notes: validation.ok
        ? [
            "Preview dry run receipt was generated without creating provider resources.",
            "Capability checks describe declared adapter support, not provider-side deployment success."
          ]
        : ["Preview dry run was denied because at least one required capability is unsupported.", "No provider resources were created."]
    }
  });

  return {
    plan: compiledPlan,
    validation,
    receipts: [receipt],
    receipt
  };
}

function plannedResource<TSpec extends PreviewPlannedResourceSpec>(
  kind: PreviewResourceKind,
  order: number,
  name: string | undefined,
  spec: TSpec
): PreviewPlannedResource<TSpec> {
  const capability = previewResourceCapabilities[kind];
  return {
    order,
    type: kind,
    kind,
    name,
    capabilityPath: capability.create,
    cleanupCapabilityPath: capability.cleanup,
    spec
  };
}

function resourceName(spec: PreviewPlannedResourceSpec): string | undefined {
  return "name" in spec ? spec.name : undefined;
}

function resourceGroups(plan: PreviewPlan): Array<{ kind: PreviewResourceKind; capsule: Capsule; spec: PreviewPlannedResourceSpec }> {
  return [
    ...(plan.databases ?? []).map((entry) => ({ kind: "database" as const, capsule: entry.capsule, spec: entry.spec })),
    ...(plan.services ?? []).map((entry) => ({ kind: "service" as const, capsule: entry.capsule, spec: entry.spec })),
    ...(plan.edges ?? []).map((entry) => ({ kind: "edge" as const, capsule: entry.capsule, spec: entry.spec })),
    ...(plan.jobs ?? []).map((entry) => ({ kind: "job" as const, capsule: entry.capsule, spec: entry.spec }))
  ];
}

function receiptOf(value: { receipt?: CapsuleReceipt } | undefined): CapsuleReceipt | undefined {
  return value?.receipt;
}

function isMockCapsule(capsule: Capsule): boolean {
  const raw = capsule.raw();
  return typeof raw === "object" && raw !== null && "mock" in raw && (raw as { mock?: unknown }).mock === true;
}

function assertRealProviders(plan: PreviewPlan): void {
  if (!plan.requireRealProviders || plan.allowMockProviders) {
    return;
  }
  const entries = resourceGroups(plan);
  for (const entry of entries) {
    if (isMockCapsule(entry.capsule)) {
      throw new MockProviderNotAllowedError(
        String((entry.capsule.raw() as { provider?: unknown } | undefined)?.provider ?? "unknown"),
        entry.capsule.adapterName()
      );
    }
  }
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

// Resource kinds without a cleanup action by design (edge, job) resolve to an "unsupported"
// disposition. Those must not fail the run, so status is "unsupported" (exit 0) unless a real
// failure (leaked or partial) is present, which stays "partial" (exit 1).
function previewCleanupStatus(dispositions: PreviewCleanupDispositionRecord[]): PreviewCleanupResult["status"] {
  if (dispositions.some((entry) => entry.disposition === "leaked" || entry.disposition === "partial")) {
    return "partial";
  }
  if (dispositions.some((entry) => entry.disposition === "unsupported")) {
    return "unsupported";
  }
  return "cleaned";
}

export function createPreviewCleanupPlan(
  preview: PreviewEnvironment,
  resources: PreviewResourceRecord[],
  options: CreatePreviewCleanupPlanOptions = {}
): PreviewCleanupPlan {
  const createdAt = options.createdAt ?? new Date();
  const planId = `cleanup_${preview.id}`;
  const actions = [...resources]
    .reverse()
    .filter((resource) => resource.cleanup)
    .map((resource, cleanupOrder): PreviewCleanupPlanAction => {
      const cleanup = resource.cleanup!;
      const actionId = `${preview.id}:cleanup:${cleanup.kind}:${resource.id}:${cleanup.capabilityPath}`;
      const idempotencyKey = actionId;
      return {
        actionId,
        cleanupOrder,
        kind: cleanup.kind,
        resourceId: resource.id,
        resourceProvider: resource.provider,
        resourceName: resource.name,
        capabilityPath: cleanup.capabilityPath,
        spec: { ...cleanup.spec, idempotencyKey },
        idempotencyKey,
        reversible: true
      };
    });
  const actionByResourceId = new Map(actions.map((action) => [action.resourceId, action]));

  return {
    schema: previewCleanupPlanSchema,
    id: planId,
    previewId: preview.id,
    createdAt: createdAt.toISOString(),
    cleanupOrder: "reverse-create-order",
    cleanupActionCount: actions.length,
    unsupportedCleanupCount: resources.length - actions.length,
    resources: resources.map((resource, order) => {
      const action = actionByResourceId.get(resource.id);
      return {
        order,
        cleanupOrder: action?.cleanupOrder,
        type: resource.type,
        kind: resource.kind,
        id: resource.id,
        provider: resource.provider,
        name: resource.name,
        url: resource.url,
        status: resource.status,
        receiptId: resource.receipt?.id,
        cleanupCapabilityPath: resource.cleanup?.capabilityPath,
        cleanupActionId: action?.actionId
      };
    }),
    actions
  };
}

function previewCreateReceipt(
  preview: PreviewEnvironment,
  resources: PreviewResourceRecord[],
  cleanupPlan: PreviewCleanupPlan,
  startedAt: Date
): CapsuleReceipt {
  return createReceipt({
    type: "preview.create",
    provider: "capsule-preview",
    adapter: "@capsule/preview",
    capabilityPath: "preview.create",
    supportLevel: "emulated",
    startedAt,
    resource: {
      id: preview.id,
      name: preview.name,
      status: preview.status
    },
    metadata: {
      resourceCount: resources.length,
      resources: resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        provider: resource.provider,
        name: resource.name,
        receiptId: resource.receipt?.id,
        cleanupActionId: cleanupPlan.resources.find((entry) => entry.id === resource.id)?.cleanupActionId,
        cleanupCapabilityPath: resource.cleanup?.capabilityPath
      })),
      cleanupPlan: {
        id: cleanupPlan.id,
        schema: cleanupPlan.schema,
        cleanupOrder: cleanupPlan.cleanupOrder,
        cleanupActionCount: cleanupPlan.cleanupActionCount,
        unsupportedCleanupCount: cleanupPlan.unsupportedCleanupCount,
        actions: cleanupPlan.actions.map((action) => ({
          actionId: action.actionId,
          cleanupOrder: action.cleanupOrder,
          kind: action.kind,
          capabilityPath: action.capabilityPath,
          resourceId: action.resourceId,
          idempotencyKey: action.idempotencyKey
        }))
      }
    },
    policy: {
      decision: preview.status === "failed" ? "denied" : "allowed",
      applied: {},
      notes: [
        "Preview create receipt is emitted by @capsule/preview orchestration.",
        "Cleanup plan actions are recorded in reverse create order and include idempotency keys."
      ]
    }
  });
}

function createCleanupReceipt(
  preview: PreviewEnvironment,
  status: PreviewCleanupResult["status"],
  dispositions: PreviewCleanupDispositionRecord[],
  startedAt: Date,
  cleanupPlan: PreviewCleanupPlan
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
      cleanupPlanId: cleanupPlan.id,
      cleanupStatus: status,
      cleanupActions: cleanupPlan.actions.map((action) => ({
        actionId: action.actionId,
        cleanupOrder: action.cleanupOrder,
        kind: action.kind,
        capabilityPath: action.capabilityPath,
        resourceId: action.resourceId,
        idempotencyKey: action.idempotencyKey
      })),
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
  assertRealProviders(plan);
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

    const preview = previewFromResources(id, plan, "ready", resources);
    const cleanupPlan = createPreviewCleanupPlan(preview, resources);
    const receipt = previewCreateReceipt(preview, resources, cleanupPlan, new Date());

    return {
      preview,
      resources,
      cleanupPlan,
      receipts: [...resources.map((resource) => resource.receipt).filter((entry): entry is CapsuleReceipt => entry !== undefined), receipt]
    };
  } catch (error) {
    const failedPreview = previewFromResources(id, plan, "failed", resources);
    throw new PreviewCreationError("Preview environment creation failed.", { preview: failedPreview, cause: error });
  }
}

export async function cleanupPreviewEnvironment(
  preview: PreviewEnvironment,
  resources: PreviewResourceRecord[],
  options: CleanupPreviewEnvironmentOptions = {}
): Promise<PreviewCleanupResult> {
  const startedAt = options.startedAt ?? new Date();
  const cleanupPlan = options.cleanupPlan ?? createPreviewCleanupPlan(preview, resources, { createdAt: startedAt });
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
      const cleanupAction = cleanupPlan.actions.find(
        (action) => action.resourceId === resource.id && action.capabilityPath === resource.cleanup?.capabilityPath
      );
      const cleanupSpec = cleanupAction?.spec ?? resource.cleanup.spec;
      if (resource.cleanup.kind === "database") {
        const result = await resource.cleanup.capsule.database.branch.delete(cleanupSpec as { project: string; branchId: string; hardDelete?: boolean });
        receipt = result.receipt;
      } else if (resource.cleanup.kind === "service") {
        const result = await resource.cleanup.capsule.service.delete(cleanupSpec as { id: string; name?: string });
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

  const status = previewCleanupStatus(dispositions);
  const receipt = createCleanupReceipt(preview, status, dispositions, startedAt, cleanupPlan);
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
  assertRealProviders(plan);
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
    const cleanupPlan = createPreviewCleanupPlan(failedPreview, resources);
    const cleanup = await cleanupPreviewEnvironment(failedPreview, resources, { cleanupPlan });
    throw new PreviewCreationError("Preview environment creation failed and cleanup was attempted.", {
      preview: failedPreview,
      cleanup,
      cause: error
    });
  }
}
