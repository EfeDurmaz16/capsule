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
  PreviewUrlEntry,
  RunJobSpec,
  ServiceDeployment
} from "@capsule-sdk/core";
import { randomBytes } from "node:crypto";
import { createReceipt, evaluateCapabilityRequirements } from "@capsule-sdk/core";

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
  /**
   * Graph-local resource reference assigned at creation, unique within one preview graph. It is the
   * authoritative join key between a resource, its cleanup action and its receipts. Provider-native ids
   * (`id`) are not unique across providers or across projects of one provider.
   */
  ref?: string;
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
  /**
   * Graph-local reference of the resource this action cleans up. Always set on plans created by this
   * package. Plans serialized before it existed omit it and are accepted only when their action can be
   * matched to exactly one resource with the same cleanup identity.
   */
  resourceRef?: string;
  resourceId: string;
  resourceProvider: string;
  /** Adapter name of the Capsule that created the resource. */
  resourceAdapter?: string;
  /** Provider scope that disambiguates resourceId, for example the database project. */
  resourceScope?: Record<string, string>;
  resourceName?: string;
  capabilityPath: CapabilityPath;
  spec: Record<string, unknown>;
  idempotencyKey: string;
  reversible: true;
}

export interface PreviewCleanupPlanResource {
  ref?: string;
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
  /** Caller-stable operation identity from PreviewPlan.operationId, when one was supplied. */
  operationId?: string;
  resources: PreviewCleanupPlanResource[];
  actions: PreviewCleanupPlanAction[];
}

export interface CreatePreviewCleanupPlanOptions {
  createdAt?: Date;
  operationId?: string;
}

export interface PreviewResourceGroup<TSpec> {
  capsule: Capsule;
  spec: TSpec;
}

export interface PreviewPlan {
  name: string;
  /**
   * Caller-stable identity of the logical preview operation, for example a pull request number plus
   * commit. It is recorded on the cleanup plan and the preview.create receipt so retries of one
   * operation can be correlated. It is not the run id: every run still gets a unique preview id, and
   * cleanup idempotency keys stay scoped to that run so a retry never reuses another run's keys.
   */
  operationId?: string;
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

/**
 * Thrown when preview creation fails part-way. It keeps everything needed to clean up the resources
 * that were created before the failure: `resources` with their cleanup bindings (each bound to the
 * Capsule that created it), a `cleanupPlan` for exactly those resources, and their provider
 * `receipts`. Pass them to `cleanupPreviewEnvironment(error.preview, error.resources, { cleanupPlan:
 * error.cleanupPlan })`. `createPreviewEnvironmentWithCleanup` has already attempted that cleanup and
 * reports it on `cleanup`.
 */
export class PreviewCreationError extends Error {
  readonly preview: PreviewEnvironment;
  readonly cleanup?: PreviewCleanupResult;
  readonly resources: PreviewResourceRecord[];
  readonly cleanupPlan?: PreviewCleanupPlan;
  readonly receipts: CapsuleReceipt[];
  readonly cause: unknown;

  constructor(
    message: string,
    options: {
      preview: PreviewEnvironment;
      cleanup?: PreviewCleanupResult;
      cause: unknown;
      resources?: PreviewResourceRecord[];
      cleanupPlan?: PreviewCleanupPlan;
      receipts?: CapsuleReceipt[];
    }
  ) {
    super(message);
    this.name = "PreviewCreationError";
    this.preview = options.preview;
    this.cleanup = options.cleanup;
    this.resources = options.resources ?? [];
    this.cleanupPlan = options.cleanupPlan;
    this.receipts = options.receipts ?? [];
    this.cause = options.cause;
  }
}

/**
 * Thrown before any cleanup effect when a supplied cleanup plan does not belong to the preview, or when a
 * plan action cannot be bound to exactly one resource with the same kind, capability, provider and cleanup
 * identity. Cleanup never falls back to another resource's action.
 */
export class PreviewCleanupPlanError extends Error {
  readonly previewId: string;
  readonly planPreviewId: string;
  readonly resourceRef?: string;

  constructor(message: string, options: { previewId: string; planPreviewId: string; resourceRef?: string }) {
    super(message);
    this.name = "PreviewCleanupPlanError";
    this.previewId = options.previewId;
    this.planPreviewId = options.planPreviewId;
    this.resourceRef = options.resourceRef;
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

/**
 * Returns a unique run id for one preview creation. The time component keeps ids roughly sortable and
 * the random component keeps two runs with the same name in the same millisecond distinct. A run id is
 * not an idempotency key; use PreviewPlan.operationId for caller-stable operation identity.
 */
export function createPreviewId(name: string): string {
  const safeName =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "preview";
  return `preview_${safeName}_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
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
    adapter: "@capsule-sdk/preview",
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
  const refs = resources.map((resource, index) => resourceRefOf(resource, index));
  const actions = resources
    .map((resource, index) => ({ resource, ref: refs[index] }))
    .reverse()
    .filter((entry) => entry.resource.cleanup)
    .map(({ resource, ref }, cleanupOrder): PreviewCleanupPlanAction => {
      const cleanup = resource.cleanup!;
      const actionId = `${preview.id}:cleanup:${ref}:${cleanup.kind}:${cleanup.capabilityPath}`;
      const idempotencyKey = actionId;
      const scope = cleanupScope(cleanup);
      return {
        actionId,
        cleanupOrder,
        kind: cleanup.kind,
        resourceRef: ref,
        resourceId: resource.id,
        resourceProvider: resource.provider,
        resourceAdapter: cleanup.capsule.adapterName(),
        ...(scope ? { resourceScope: scope } : {}),
        resourceName: resource.name,
        capabilityPath: cleanup.capabilityPath,
        spec: { ...cleanup.spec, idempotencyKey },
        idempotencyKey,
        reversible: true
      };
    });
  const actionByRef = new Map(actions.map((action) => [action.resourceRef, action]));

  return {
    schema: previewCleanupPlanSchema,
    id: planId,
    previewId: preview.id,
    createdAt: createdAt.toISOString(),
    cleanupOrder: "reverse-create-order",
    cleanupActionCount: actions.length,
    unsupportedCleanupCount: resources.length - actions.length,
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    resources: resources.map((resource, order) => {
      const action = actionByRef.get(refs[order]);
      return {
        ref: refs[order],
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

function resourceRefOf(resource: PreviewResourceRecord, index: number): string {
  return resource.ref ?? `resource-${index}`;
}

// Fields of a cleanup spec that name the provider resource. A plan action may only be bound to a
// resource whose own cleanup spec carries the same values, so a plan cannot redirect deletion.
const cleanupIdentityFields: Record<PreviewResourceKind, readonly string[]> = {
  database: ["project", "branchId"],
  service: ["id"],
  edge: [],
  job: []
};

function cleanupScope(cleanup: PreviewCleanupAction): Record<string, string> | undefined {
  if (cleanup.kind === "database" && typeof cleanup.spec.project === "string") {
    return { project: cleanup.spec.project };
  }
  return undefined;
}

function sameCleanupIdentity(spec: Record<string, unknown>, cleanup: PreviewCleanupAction): boolean {
  return cleanupIdentityFields[cleanup.kind].every((field) => spec[field] === cleanup.spec[field]);
}

function actionMatchesResource(action: PreviewCleanupPlanAction, resource: PreviewResourceRecord, cleanup: PreviewCleanupAction): boolean {
  return (
    action.kind === cleanup.kind &&
    action.capabilityPath === cleanup.capabilityPath &&
    action.resourceId === resource.id &&
    action.resourceProvider === resource.provider &&
    typeof action.spec === "object" &&
    action.spec !== null &&
    sameCleanupIdentity(action.spec, cleanup)
  );
}

/**
 * Binds every cleanup-capable resource to at most one action of a supplied plan, before any effect.
 * Resources with a graph-local ref bind by ref. Resources or plan actions without a ref (plans
 * serialized before refs existed) bind only when exactly one action has the same kind, capability,
 * provider, native id and cleanup identity. Anything else throws PreviewCleanupPlanError.
 */
function bindCleanupPlan(
  preview: PreviewEnvironment,
  resources: PreviewResourceRecord[],
  plan: PreviewCleanupPlan
): Map<PreviewResourceRecord, PreviewCleanupPlanAction | undefined> {
  const context = { previewId: preview.id, planPreviewId: String(plan.previewId) };
  if (plan.previewId !== preview.id) {
    throw new PreviewCleanupPlanError(`Cleanup plan belongs to preview ${String(plan.previewId)}, not ${preview.id}.`, context);
  }
  if (!Array.isArray(plan.actions)) {
    throw new PreviewCleanupPlanError("Cleanup plan actions must be an array.", context);
  }
  const actionsByRef = new Map<string, PreviewCleanupPlanAction>();
  const legacyActions: PreviewCleanupPlanAction[] = [];
  for (const action of plan.actions) {
    if (action.resourceRef === undefined) {
      legacyActions.push(action);
      continue;
    }
    if (actionsByRef.has(action.resourceRef)) {
      throw new PreviewCleanupPlanError(`Cleanup plan has more than one action for resource ${action.resourceRef}.`, {
        ...context,
        resourceRef: action.resourceRef
      });
    }
    actionsByRef.set(action.resourceRef, action);
  }

  const bindings = new Map<PreviewResourceRecord, PreviewCleanupPlanAction | undefined>();
  for (const resource of resources) {
    const cleanup = resource.cleanup;
    if (!cleanup) continue;
    if (resource.ref !== undefined) {
      const action = actionsByRef.get(resource.ref);
      if (action) {
        if (!actionMatchesResource(action, resource, cleanup)) {
          throw new PreviewCleanupPlanError(`Cleanup plan action for resource ${resource.ref} does not match that resource's kind, provider or identity.`, {
            ...context,
            resourceRef: resource.ref
          });
        }
        bindings.set(resource, action);
        continue;
      }
    }
    const pool = resource.ref === undefined ? plan.actions : legacyActions;
    const candidates = pool.filter((action) => actionMatchesResource(action, resource, cleanup));
    if (candidates.length > 1) {
      throw new PreviewCleanupPlanError(`Cleanup plan is ambiguous for ${resource.kind} resource ${resource.id}; refusing to guess which action applies.`, {
        ...context,
        resourceRef: resource.ref
      });
    }
    bindings.set(resource, candidates[0]);
  }
  return bindings;
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
    adapter: "@capsule-sdk/preview",
    capabilityPath: "preview.create",
    supportLevel: "emulated",
    startedAt,
    resource: {
      id: preview.id,
      name: preview.name,
      status: preview.status
    },
    metadata: {
      ...(cleanupPlan.operationId === undefined ? {} : { operationId: cleanupPlan.operationId }),
      resourceCount: resources.length,
      resources: resources.map((resource, index) => ({
        ref: cleanupPlan.resources[index]?.ref,
        id: resource.id,
        kind: resource.kind,
        provider: resource.provider,
        name: resource.name,
        receiptId: resource.receipt?.id,
        cleanupActionId: cleanupPlan.resources[index]?.cleanupActionId,
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
          resourceRef: action.resourceRef,
          resourceId: action.resourceId,
          idempotencyKey: action.idempotencyKey
        }))
      }
    },
    policy: {
      decision: preview.status === "failed" ? "denied" : "allowed",
      applied: {},
      notes: [
        "Preview create receipt is emitted by @capsule-sdk/preview orchestration.",
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
    adapter: "@capsule-sdk/preview",
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
        resourceRef: action.resourceRef,
        resourceId: action.resourceId,
        idempotencyKey: action.idempotencyKey
      })),
      resources: dispositions.map((entry) => ({
        ref: entry.resource.ref,
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
        "Preview cleanup receipt is emitted by @capsule-sdk/preview orchestration.",
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
      spec: Object.freeze({ id: resource.id, name: resource.name })
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
      spec: Object.freeze({ project: resource.project, branchId: resource.id })
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

// A cancelled required check never passed, so it cannot make a preview ready. Running services stay
// ready-eligible. Running jobs and unknown statuses keep the existing behavior (they do not block
// ready); callers that need passed checks should require a terminal "succeeded" job status.
const failedResourceStatuses = new Set(["failed", "error", "errored", "crashed", "cancelled", "canceled"]);
const pendingResourceStatuses = new Set(["creating", "pending", "provisioning", "queued", "deploying"]);

export function aggregatePreviewStatus(resources: PreviewResourceRecord[]): PreviewEnvironment["status"] {
  const statuses = resources.map((resource) => resource.status?.toLowerCase()).filter((status): status is string => typeof status === "string");
  if (statuses.some((status) => failedResourceStatuses.has(status))) {
    return "failed";
  }
  if (statuses.some((status) => pendingResourceStatuses.has(status))) {
    return "creating";
  }
  if (statuses.length > 0 && statuses.every((status) => status === "deleted")) {
    return "deleted";
  }
  return "ready";
}

export function previewUrlRegistry(resources: PreviewResourceRecord[]): PreviewUrlEntry[] {
  return resources
    .filter((resource): resource is PreviewResourceRecord & { url: string } => typeof resource.url === "string")
    .map((resource) => ({ resourceId: resource.id, type: resource.type, provider: resource.provider, url: resource.url }));
}

function withRef(record: PreviewResourceRecord, index: number): PreviewResourceRecord {
  return { ref: `resource-${index}`, ...record };
}

function previewFromResources(id: string, plan: PreviewPlan, status: PreviewEnvironment["status"], resources: PreviewResourceRecord[]): PreviewEnvironment {
  const urlEntries = previewUrlRegistry(resources);
  return {
    id,
    provider: "capsule-preview",
    name: plan.name,
    status,
    urls: urlEntries.map((entry) => entry.url),
    urlEntries,
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

// Provisions the plan in its fixed order (databases, services, edges, jobs) and appends each created
// resource to `resources` as soon as it exists, so a failure part-way leaves the created prefix intact.
async function provisionPreviewResources(plan: PreviewPlan, resources: PreviewResourceRecord[]): Promise<void> {
  for (const entry of plan.databases ?? []) {
    resources.push(withRef(databaseRecord(await entry.capsule.database.branch.create(entry.spec), entry.capsule), resources.length));
  }
  for (const entry of plan.services ?? []) {
    resources.push(withRef(serviceRecord(await entry.capsule.service.deploy(entry.spec), entry.capsule), resources.length));
  }
  for (const entry of plan.edges ?? []) {
    resources.push(withRef(edgeRecord(await entry.capsule.edge.deploy(entry.spec)), resources.length));
  }
  for (const entry of plan.jobs ?? []) {
    resources.push(withRef(jobRecord(await entry.capsule.job.run(entry.spec)), resources.length));
  }
}

function resourceReceipts(resources: PreviewResourceRecord[]): CapsuleReceipt[] {
  return resources.map((resource) => resource.receipt).filter((entry): entry is CapsuleReceipt => entry !== undefined);
}

export async function createPreviewGraph(plan: PreviewPlan): Promise<PreviewOrchestrationResult> {
  assertRealProviders(plan);
  // Aggregate timing starts before the first provisioning call so the preview.create receipt
  // duration covers the provider work it summarizes.
  const startedAt = new Date();
  const id = createPreviewId(plan.name);
  const resources: PreviewResourceRecord[] = [];

  try {
    await provisionPreviewResources(plan, resources);
  } catch (error) {
    // The basic API does not clean up. It hands back the created resources, their cleanup bindings,
    // a cleanup plan and receipts so the caller can clean up without reconstructing provider identity.
    const failedPreview = previewFromResources(id, plan, "failed", resources);
    throw new PreviewCreationError("Preview environment creation failed.", {
      preview: failedPreview,
      cause: error,
      resources,
      cleanupPlan: createPreviewCleanupPlan(failedPreview, resources, { operationId: plan.operationId }),
      receipts: resourceReceipts(resources)
    });
  }

  const preview = previewFromResources(id, plan, aggregatePreviewStatus(resources), resources);
  const cleanupPlan = createPreviewCleanupPlan(preview, resources, { operationId: plan.operationId });
  const receipt = previewCreateReceipt(preview, resources, cleanupPlan, startedAt);

  return {
    preview,
    resources,
    cleanupPlan,
    receipts: [...resourceReceipts(resources), receipt]
  };
}

export async function cleanupPreviewEnvironment(
  preview: PreviewEnvironment,
  resources: PreviewResourceRecord[],
  options: CleanupPreviewEnvironmentOptions = {}
): Promise<PreviewCleanupResult> {
  const startedAt = options.startedAt ?? new Date();
  const cleanupPlan = options.cleanupPlan ?? createPreviewCleanupPlan(preview, resources, { createdAt: startedAt });
  // Bind every resource to its own plan action (or none) before the first delete, so a foreign or
  // ambiguous plan fails without effects instead of routing one resource's spec to another Capsule.
  const bindings = bindCleanupPlan(preview, resources, cleanupPlan);
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
      const cleanupSpec: Record<string, unknown> = bindings.get(resource)?.spec ?? resource.cleanup.spec;
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

/**
 * Creates the preview and, when creation throws part-way, attempts cleanup of the resources created so
 * far before rethrowing. A preview that is created but aggregates to `failed` (for example a failed or
 * cancelled check job) is returned, not cleaned up; callers decide whether to clean it up.
 */
export async function createPreviewEnvironmentWithCleanup(plan: PreviewPlan): Promise<PreviewEnvironment> {
  assertRealProviders(plan);
  const id = createPreviewId(plan.name);
  const resources: PreviewResourceRecord[] = [];

  try {
    await provisionPreviewResources(plan, resources);
  } catch (error) {
    const failedPreview = previewFromResources(id, plan, "failed", resources);
    const cleanupPlan = createPreviewCleanupPlan(failedPreview, resources, { operationId: plan.operationId });
    const cleanup = await cleanupPreviewEnvironment(failedPreview, resources, { cleanupPlan });
    throw new PreviewCreationError("Preview environment creation failed and cleanup was attempted.", {
      preview: failedPreview,
      cleanup,
      cause: error,
      resources,
      cleanupPlan,
      receipts: resourceReceipts(resources)
    });
  }
  return previewFromResources(id, plan, aggregatePreviewStatus(resources), resources);
}
