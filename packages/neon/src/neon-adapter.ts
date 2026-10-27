import {
  type AdapterContext,
  AdapterExecutionError,
  type CapsuleAdapter,
  type CapabilityMap,
  providerErrorStatus,
  providerRuntimeMetadata,
  type CreateDatabaseBranchSpec,
  type DatabaseBranch,
  type ResetDatabaseBranch,
  type DeletedDatabaseBranch,
  type DeleteDatabaseBranchSpec,
  type ResetDatabaseBranchSpec
} from "@capsule-sdk/core";
import { NeonClient, type NeonClientOptions } from "./neon-client.js";

export interface NeonAdapterOptions extends NeonClientOptions {
  databaseName?: string;
  roleName?: string;
  pooled?: boolean;
  createEndpoint?: boolean;
}

interface NeonOperation {
  id: string;
  action?: string;
  status?: string;
}

interface NeonBranchResponse {
  branch: {
    id: string;
    name: string;
    parent_id?: string;
    current_state?: string;
    pending_state?: string;
  };
  endpoints?: Array<{ id: string; host?: string; type?: string }>;
  operations?: NeonOperation[];
}

// Neon branch mutations return immediately with background operations. A branch is ready only when its
// current state is ready, no pending state is set and every returned operation reached a non-failed
// terminal status (EDGE-04). Operation statuses: scheduling, running, finished, failed, error,
// cancelling, cancelled, skipped.
const settledOperationStatuses = new Set(["finished", "skipped", "cancelled"]);
const failedOperationStatuses = new Set(["failed", "error"]);

interface BranchProgress {
  phase: "ready" | "in-progress" | "failed";
  currentState?: string;
  pendingState?: string;
  operationIds: string[];
  pendingOperationIds: string[];
  failedOperationIds: string[];
}

function branchProgress(response: NeonBranchResponse): BranchProgress {
  const operations = response.operations ?? [];
  const pendingOperationIds = operations
    .filter((operation) => !settledOperationStatuses.has(operation.status ?? "") && !failedOperationStatuses.has(operation.status ?? ""))
    .map((operation) => operation.id);
  const failedOperationIds = operations.filter((operation) => failedOperationStatuses.has(operation.status ?? "")).map((operation) => operation.id);
  const currentState = response.branch.current_state;
  const pendingState = response.branch.pending_state;
  const phase =
    currentState === "failed" || failedOperationIds.length > 0
      ? "failed"
      : currentState === "ready" && !pendingState && pendingOperationIds.length === 0
        ? "ready"
        : "in-progress";
  return { phase, currentState, pendingState, operationIds: operations.map((operation) => operation.id), pendingOperationIds, failedOperationIds };
}

function progressMetadata(progress: BranchProgress): Record<string, unknown> {
  return {
    currentState: progress.currentState,
    ...(progress.pendingState ? { pendingState: progress.pendingState } : {}),
    ...(progress.operationIds.length > 0 ? { operationIds: progress.operationIds } : {}),
    ...(progress.pendingOperationIds.length > 0 ? { pendingOperationIds: progress.pendingOperationIds } : {}),
    ...(progress.failedOperationIds.length > 0 ? { failedOperationIds: progress.failedOperationIds } : {})
  };
}

interface NeonConnectionUriResponse {
  uri?: string;
  connection_uri?: string;
}

const provider = "neon";
const adapter = "neon";
const adapterVersion = "0.1.1";
const providerApiVersion = "v2";

export const neonCapabilities: CapabilityMap = {
  database: {
    branchCreate: "native",
    branchDelete: "native",
    branchReset: "native",
    connectionString: "native",
    migrate: "unsupported",
    snapshot: "unsupported",
    restore: "unsupported"
  },
  preview: {
    create: "unsupported",
    destroy: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    urls: "unsupported",
    ttl: "unsupported",
    cleanup: "unsupported"
  }
};

function createBranchBody(spec: CreateDatabaseBranchSpec, options: NeonAdapterOptions) {
  return {
    branch: {
      name: spec.name,
      ...(spec.parent ? { parent_id: spec.parent } : {})
    },
    ...(options.createEndpoint === false
      ? {}
      : {
          endpoints: [{ type: "read_write" }]
        })
  };
}

function resetBranchBody(spec: ResetDatabaseBranchSpec) {
  const sourceBranchId = spec.sourceBranchId ?? spec.parent;
  if (!sourceBranchId) {
    throw new AdapterExecutionError("Neon branch reset requires sourceBranchId or parent.");
  }
  if (sourceBranchId === spec.branchId && !spec.pointInTime && !spec.sourceLsn) {
    throw new AdapterExecutionError("Neon self-restore requires pointInTime or sourceLsn.");
  }
  if (sourceBranchId === spec.branchId && !spec.preserveUnderName) {
    throw new AdapterExecutionError("Neon self-restore requires preserveUnderName so the previous branch state can be retained.");
  }
  return {
    source_branch_id: sourceBranchId,
    ...(spec.pointInTime ? { source_timestamp: spec.pointInTime } : {}),
    ...(spec.sourceLsn ? { source_lsn: spec.sourceLsn } : {}),
    ...(spec.preserveUnderName ? { preserve_under_name: spec.preserveUnderName } : {})
  };
}

function neonReceiptMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...providerRuntimeMetadata({ providerApiVersion, adapterVersion }),
    ...metadata
  };
}

async function getConnectionString(client: NeonClient, project: string, branchId: string, options: NeonAdapterOptions): Promise<string | undefined> {
  if (!options.databaseName || !options.roleName) {
    return undefined;
  }
  const response = await client.request<NeonConnectionUriResponse>({
    path: `/projects/${encodeURIComponent(project)}/connection_uri`,
    query: {
      branch_id: branchId,
      database_name: options.databaseName,
      role_name: options.roleName,
      pooled: options.pooled
    }
  });
  return response.uri ?? response.connection_uri;
}

export function neon(options: NeonAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => new NeonClient(options);
  return {
    name: adapter,
    provider,
    capabilities: neonCapabilities,
    raw: { baseUrl: options.baseUrl ?? "https://console.neon.tech/api/v2" },
    database: {
      branch: {
        create: async (spec: CreateDatabaseBranchSpec, context: AdapterContext): Promise<DatabaseBranch> => {
          const client = getClient();
          const startedAt = new Date();
          const response = await client.request<NeonBranchResponse>({
            method: "POST",
            path: `/projects/${encodeURIComponent(spec.project)}/branches`,
            body: createBranchBody(spec, options)
          });
          let connectionString: string | undefined;
          try {
            connectionString = await getConnectionString(client, spec.project, response.branch.id, options);
          } catch (error) {
            await client
              .request<unknown>({
                method: "DELETE",
                path: `/projects/${encodeURIComponent(spec.project)}/branches/${encodeURIComponent(response.branch.id)}`,
                query: { hard_delete: true }
              })
              .catch(() => undefined);
            throw error;
          }
          const progress = branchProgress(response);
          const status: DatabaseBranch["status"] = progress.phase === "ready" ? "ready" : progress.phase === "failed" ? "failed" : "creating";
          const receipt = context.receipts
            ? context.createReceipt({
                type: "database.branch.create",
                capabilityPath: "database.branchCreate",
                startedAt,
                policy: {
                  decision: "allowed",
                  applied: context.policy,
                  notes: [
                    "Neon branch creation is native.",
                    connectionString
                      ? "Connection URI retrieved from Neon API."
                      : "Connection URI not requested; configure databaseName and roleName to retrieve it.",
                    ...(status === "creating" ? ["Neon is still running branch operations; the branch is creating, not ready."] : [])
                  ]
                },
                resource: {
                  id: response.branch.id,
                  name: response.branch.name,
                  status
                },
                metadata: neonReceiptMetadata({
                  ...progressMetadata(progress),
                  parent: response.branch.parent_id,
                  endpointIds: response.endpoints?.map((endpoint) => endpoint.id),
                  ttlMs: spec.ttlMs,
                  labels: spec.labels
                })
              })
            : undefined;
          return {
            id: response.branch.id,
            provider,
            project: spec.project,
            name: response.branch.name,
            parent: response.branch.parent_id,
            connectionString,
            status,
            receipt
          };
        },
        delete: async (spec: DeleteDatabaseBranchSpec, context: AdapterContext): Promise<DeletedDatabaseBranch> => {
          const client = getClient();
          const startedAt = new Date();
          let alreadyAbsent = false;
          try {
            await client.request<unknown>({
              method: "DELETE",
              path: `/projects/${encodeURIComponent(spec.project)}/branches/${encodeURIComponent(spec.branchId)}`,
              query: { hard_delete: spec.hardDelete }
            });
          } catch (error) {
            if (providerErrorStatus(error) !== 404) {
              throw error;
            }
            alreadyAbsent = true;
          }
          const receipt = context.receipts
            ? context.createReceipt({
                type: "database.branch.delete",
                capabilityPath: "database.branchDelete",
                startedAt,
                policy: {
                  decision: "allowed",
                  applied: context.policy,
                  notes: [
                    "Neon branch deletion is native.",
                    spec.hardDelete
                      ? "hard_delete requested; branch recovery window is bypassed if Neon account supports it."
                      : "Default Neon delete behavior may allow branch recovery.",
                    ...(alreadyAbsent ? ["Branch was already absent; delete treated as idempotent success."] : [])
                  ]
                },
                resource: { id: spec.branchId, status: "deleted" },
                metadata: neonReceiptMetadata({ project: spec.project, hardDelete: spec.hardDelete })
              })
            : undefined;
          return { id: spec.branchId, provider, project: spec.project, status: "deleted", receipt };
        },
        reset: async (spec: ResetDatabaseBranchSpec, context: AdapterContext): Promise<ResetDatabaseBranch> => {
          const client = getClient();
          const startedAt = new Date();
          const body = resetBranchBody(spec);
          const response = await client.request<NeonBranchResponse>({
            method: "POST",
            path: `/projects/${encodeURIComponent(spec.project)}/branches/${encodeURIComponent(spec.branchId)}/restore`,
            body
          });
          const progress = branchProgress(response);
          const status: ResetDatabaseBranch["status"] = progress.phase === "ready" ? "ready" : progress.phase === "failed" ? "failed" : "resetting";
          const receipt = context.receipts
            ? context.createReceipt({
                type: "database.branch.reset",
                capabilityPath: "database.branchReset",
                startedAt,
                policy: {
                  decision: "allowed",
                  applied: context.policy,
                  notes: [
                    "Neon branch reset is mapped to the native branch restore API.",
                    spec.pointInTime || spec.sourceLsn ? "Point-in-time restore input was delegated to Neon." : "Reset uses the head of the source branch.",
                    "Connection strings are not fetched by reset; call branch create or provider APIs when connection metadata is needed."
                  ]
                },
                resource: {
                  id: response.branch.id,
                  name: response.branch.name,
                  status
                },
                metadata: neonReceiptMetadata({
                  ...progressMetadata(progress),
                  project: spec.project,
                  sourceBranchId: body.source_branch_id,
                  sourceTimestamp: spec.pointInTime,
                  sourceLsn: spec.sourceLsn,
                  preserveUnderName: spec.preserveUnderName,
                  parent: response.branch.parent_id,
                  reason: spec.reason,
                  labels: spec.labels
                })
              })
            : undefined;
          return {
            id: response.branch.id,
            provider,
            project: spec.project,
            parent: response.branch.parent_id,
            status,
            receipt,
            metadata: {
              ...progressMetadata(progress),
              name: response.branch.name,
              sourceBranchId: body.source_branch_id,
              preserveUnderName: spec.preserveUnderName
            }
          };
        }
      }
    }
  };
}
