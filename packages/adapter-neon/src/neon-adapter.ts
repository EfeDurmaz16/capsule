import {
  type AdapterContext,
  AdapterExecutionError,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateDatabaseBranchSpec,
  type DatabaseBranch,
  type ResetDatabaseBranch,
  type DeletedDatabaseBranch,
  type DeleteDatabaseBranchSpec,
  type ResetDatabaseBranchSpec
} from "@capsule/core";
import { NeonClient, type NeonClientOptions } from "./neon-client.js";

export interface NeonAdapterOptions extends NeonClientOptions {
  databaseName?: string;
  roleName?: string;
  pooled?: boolean;
  createEndpoint?: boolean;
}

interface NeonBranchResponse {
  branch: {
    id: string;
    name: string;
    parent_id?: string;
    current_state?: string;
  };
  endpoints?: Array<{ id: string; host?: string; type?: string }>;
}

interface NeonConnectionUriResponse {
  uri?: string;
  connection_uri?: string;
}

const provider = "neon";
const adapter = "neon";

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

async function getConnectionString(
  client: NeonClient,
  project: string,
  branchId: string,
  options: NeonAdapterOptions
): Promise<string | undefined> {
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
          const connectionString = await getConnectionString(client, spec.project, response.branch.id, options);
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
                    connectionString ? "Connection URI retrieved from Neon API." : "Connection URI not requested; configure databaseName and roleName to retrieve it."
                  ]
                },
                resource: {
                  id: response.branch.id,
                  name: response.branch.name,
                  status: response.branch.current_state ?? "ready"
                },
                metadata: {
                  parent: response.branch.parent_id,
                  endpointIds: response.endpoints?.map((endpoint) => endpoint.id),
                  ttlMs: spec.ttlMs,
                  labels: spec.labels
                }
              })
            : undefined;
          return {
            id: response.branch.id,
            provider,
            project: spec.project,
            name: response.branch.name,
            parent: response.branch.parent_id,
            connectionString,
            status: "ready",
            receipt
          };
        },
        delete: async (spec: DeleteDatabaseBranchSpec, context: AdapterContext): Promise<DeletedDatabaseBranch> => {
          const client = getClient();
          const startedAt = new Date();
          await client.request<unknown>({
            method: "DELETE",
            path: `/projects/${encodeURIComponent(spec.project)}/branches/${encodeURIComponent(spec.branchId)}`,
            query: { hard_delete: spec.hardDelete }
          });
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
                    spec.hardDelete ? "hard_delete requested; branch recovery window is bypassed if Neon account supports it." : "Default Neon delete behavior may allow branch recovery."
                  ]
                },
                resource: { id: spec.branchId, status: "deleted" },
                metadata: { project: spec.project, hardDelete: spec.hardDelete }
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
                  status: response.branch.current_state ?? "ready"
                },
                metadata: {
                  project: spec.project,
                  sourceBranchId: body.source_branch_id,
                  sourceTimestamp: spec.pointInTime,
                  sourceLsn: spec.sourceLsn,
                  preserveUnderName: spec.preserveUnderName,
                  parent: response.branch.parent_id,
                  reason: spec.reason,
                  labels: spec.labels
                }
              })
            : undefined;
          return {
            id: response.branch.id,
            provider,
            project: spec.project,
            parent: response.branch.parent_id,
            status: response.branch.current_state === "failed" ? "failed" : "ready",
            receipt,
            metadata: {
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
