import {
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateDatabaseBranchSpec,
  type DatabaseBranch,
  type DeletedDatabaseBranch,
  type DeleteDatabaseBranchSpec
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
    branchReset: "unsupported",
    connectionString: "native",
    migrate: "unsupported",
    snapshot: "unsupported",
    restore: "unsupported"
  },
  preview: {
    create: "experimental",
    destroy: "experimental",
    status: "experimental",
    logs: "unsupported",
    urls: "unsupported",
    ttl: "emulated",
    cleanup: "experimental"
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
        }
      }
    }
  };
}
