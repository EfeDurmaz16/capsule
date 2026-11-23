import { createHash, randomUUID } from "node:crypto";
import { AdapterExecutionError, type CapsuleAdapter, type MachineStatus } from "@capsule-sdk/core";

export interface GceOptions {
  projectId: string;
  zone: string;
  accessToken: () => string | Promise<string>;
  network?: string;
  startupScript?: string;
  sshKeys?: string;
  maxRunSeconds?: number;
  fetch?: typeof fetch;
}

interface Operation {
  name: string;
  status: string;
  error?: { errors?: { code?: string }[] };
}

interface Instance {
  status: string;
  networkInterfaces?: { accessConfigs?: { natIP?: string }[] }[];
}

const provider = "gce";
const machineStates: Partial<Record<string, MachineStatus>> = {
  PROVISIONING: "creating",
  STAGING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  SUSPENDING: "stopping",
  SUSPENDED: "stopped",
  TERMINATED: "stopped",
  REPAIRING: "starting"
};

function resourceName(value: string, field: string): string {
  if (!/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new AdapterExecutionError(`Invalid Compute Engine ${field}.`);
  }
  return value;
}

function requestId(scope: string, action: string, key?: string): string {
  if (!key) return randomUUID();
  const hash = createHash("sha256")
    .update(JSON.stringify([scope, action, key]))
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function gce(options: GceOptions): CapsuleAdapter {
  const project = resourceName(options.projectId, "project ID");
  const zone = resourceName(options.zone, "zone");
  const root = `https://compute.googleapis.com/compute/v1/projects/${project}/zones/${zone}`;
  const fetcher = options.fetch ?? fetch;

  async function request<T>(path: string, method = "GET", body?: object): Promise<T | undefined> {
    const response = await fetcher(root + path, {
      method,
      headers: {
        authorization: `Bearer ${await options.accessToken()}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
      redirect: "error"
    });
    if (response.status === 404 && (method === "GET" || method === "DELETE")) return undefined;
    if (!response.ok) {
      throw new AdapterExecutionError(`Compute Engine ${method} failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  return {
    name: provider,
    provider,
    capabilities: { machine: { create: "native", status: "native", destroy: "native", exec: "unsupported", start: "unsupported", stop: "unsupported" } },
    machine: {
      async create(spec, context) {
        const startedAt = new Date();
        const name = resourceName(spec.name, "instance name");
        const policy = context.evaluatePolicy({ env: spec.env });
        if (Object.keys(spec.env ?? {}).length > 0) {
          throw new AdapterExecutionError("Compute Engine machine environment values require a separate delivery mechanism.");
        }
        if (spec.region && spec.region !== zone.slice(0, -2)) {
          throw new AdapterExecutionError("The requested region does not match the configured Compute Engine zone.");
        }
        const size = resourceName(spec.size ?? "e2-small", "machine type");
        const network = resourceName(options.network ?? "default", "network");
        const image = spec.image ?? "projects/debian-cloud/global/images/family/debian-12";
        const operation = await request<Operation>(`/instances?requestId=${requestId(root, "create", spec.idempotencyKey)}`, "POST", {
          name,
          machineType: `zones/${zone}/machineTypes/${size}`,
          labels: spec.labels,
          disks: [
            { boot: true, autoDelete: true, initializeParams: { sourceImage: image, diskSizeGb: "20", diskType: `zones/${zone}/diskTypes/pd-standard` } }
          ],
          networkInterfaces: [{ network: `global/networks/${network}`, accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] }],
          serviceAccounts: [],
          metadata: {
            items: [
              { key: "block-project-ssh-keys", value: "TRUE" },
              ...(options.startupScript ? [{ key: "startup-script", value: options.startupScript }] : []),
              ...(options.sshKeys ? [{ key: "ssh-keys", value: options.sshKeys }] : [])
            ]
          },
          ...(options.maxRunSeconds ? { scheduling: { maxRunDuration: { seconds: String(options.maxRunSeconds) }, instanceTerminationAction: "DELETE" } } : {})
        });
        if (!operation || operation.error) {
          throw new AdapterExecutionError("Compute Engine rejected the instance creation operation.", {
            operation: operation?.name,
            codes: operation?.error?.errors?.map((error) => error.code)
          });
        }
        const status = "creating";
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.create",
              capabilityPath: "machine.create",
              startedAt,
              image,
              policy,
              resource: { id: name, name, status },
              metadata: { project, zone, operation: operation.name }
            })
          : undefined;
        return { id: name, provider, name, status, receipt };
      },
      async status(spec, context) {
        const startedAt = new Date();
        const name = resourceName(spec.id, "instance name");
        const instance = await request<Instance>(`/instances/${name}`);
        const status = instance ? machineStates[instance.status] : "deleted";
        if (!status) throw new AdapterExecutionError("Compute Engine returned an unknown instance state.", { state: instance?.status });
        const metadata = { project, zone, externalIp: instance?.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP };
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.status",
              capabilityPath: "machine.status",
              startedAt,
              resource: { id: name, name, status },
              metadata
            })
          : undefined;
        return { id: name, provider, name, status, metadata, receipt };
      },
      async destroy(spec, context) {
        const startedAt = new Date();
        const name = resourceName(spec.id, "instance name");
        const operation = await request<Operation>(`/instances/${name}?requestId=${requestId(root, "destroy", spec.idempotencyKey)}`, "DELETE");
        if (operation?.error) {
          throw new AdapterExecutionError("Compute Engine rejected the instance deletion operation.", { operation: operation.name });
        }
        const status = !operation || operation.status === "DONE" ? "deleted" : "destroying";
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.destroy",
              capabilityPath: "machine.destroy",
              startedAt,
              resource: { id: name, status },
              metadata: { project, zone, operation: operation?.name }
            })
          : undefined;
        return { id: name, provider, status, receipt };
      }
    }
  };
}
