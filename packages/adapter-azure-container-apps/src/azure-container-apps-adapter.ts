import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CancelJobResult,
  type CancelJobSpec,
  type DeletedService,
  type DeleteServiceSpec,
  type DeployServiceSpec,
  type JobRun,
  type JobStatusResult,
  type JobStatusSpec,
  type RunJobSpec,
  type ServiceDeployment,
  type ServiceStatusResult,
  type ServiceStatusSpec
} from "@capsule/core";
import { AzureContainerAppsClient, type AzureContainerAppsClientOptions } from "./azure-container-apps-client.js";

export interface AzureContainerAppsAdapterOptions extends AzureContainerAppsClientOptions {
  location?: string;
  environmentId?: string;
  workloadProfileName?: string;
}

interface AzureResource {
  id?: string;
  name?: string;
  properties?: {
    status?: string;
    provisioningState?: string;
    runningStatus?: string;
    configuration?: {
      ingress?: {
        fqdn?: string;
      };
    };
  };
}

const provider = "azure-container-apps";
const adapter = "azure-container-apps";

export const azureContainerAppsCapabilities: CapabilityMap = {
  job: {
    run: "native",
    status: "native",
    cancel: "native",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "experimental",
    env: "native",
    resources: "native"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "native",
    status: "native",
    logs: "unsupported",
    url: "native",
    scale: "native",
    rollback: "unsupported",
    healthcheck: "experimental",
    secrets: "unsupported"
  }
};

function required(name: string, value: string | undefined): string {
  if (!value) throw new AdapterExecutionError(`Azure Container Apps adapter requires ${name}.`);
  return value;
}

function env(env: Record<string, string> | undefined): Array<{ name: string; value: string }> | undefined {
  const entries = Object.entries(env ?? {});
  return entries.length > 0 ? entries.map(([name, value]) => ({ name, value })) : undefined;
}

function resources(spec: RunJobSpec | DeployServiceSpec) {
  return spec.resources ? { cpu: spec.resources.cpu, memory: spec.resources.memoryMb ? `${spec.resources.memoryMb / 1024}Gi` : undefined } : undefined;
}

function serviceBody(spec: DeployServiceSpec, options: AzureContainerAppsAdapterOptions) {
  const image = required("service image", spec.image);
  const port = spec.ports?.[0]?.port;
  return {
    location: required("location", options.location ?? process.env.AZURE_LOCATION),
    properties: {
      environmentId: required("environmentId", options.environmentId ?? process.env.AZURE_CONTAINERAPPS_ENVIRONMENT_ID),
      workloadProfileName: options.workloadProfileName,
      configuration: {
        ingress: port ? { external: spec.ports?.[0]?.public ?? true, targetPort: port, transport: spec.ports?.[0]?.protocol === "tcp" ? "tcp" : "http" } : undefined
      },
      template: {
        containers: [
          {
            name: spec.name,
            image,
            env: env(spec.env),
            resources: resources(spec)
          }
        ],
        scale: spec.scale ? { minReplicas: spec.scale.min, maxReplicas: spec.scale.max } : undefined
      }
    },
    tags: spec.labels
  };
}

function jobBody(spec: RunJobSpec, options: AzureContainerAppsAdapterOptions) {
  const command = Array.isArray(spec.command) ? spec.command : spec.command ? ["sh", "-lc", spec.command] : undefined;
  return {
    location: required("location", options.location ?? process.env.AZURE_LOCATION),
    properties: {
      environmentId: required("environmentId", options.environmentId ?? process.env.AZURE_CONTAINERAPPS_ENVIRONMENT_ID),
      configuration: {
        triggerType: "Manual",
        replicaTimeout: spec.timeoutMs ? Math.ceil(spec.timeoutMs / 1000) : undefined,
        replicaRetryLimit: 0
      },
      template: {
        containers: [
          {
            name: spec.name ?? "main",
            image: spec.image,
            command,
            env: env(spec.env),
            resources: resources(spec)
          }
        ]
      }
    },
    tags: spec.labels
  };
}

function resourceStatus(resource: AzureResource): ServiceDeployment["status"] {
  if (resource.properties?.runningStatus === "Stopped") return "failed";
  const state = resource.properties?.provisioningState;
  if (state === "Succeeded") return "ready";
  if (state === "Failed") return "failed";
  return "deploying";
}

function jobStatus(resource: AzureResource): JobRun["status"] {
  switch (resource.properties?.status ?? resource.properties?.runningStatus ?? resource.properties?.provisioningState) {
    case "Succeeded":
    case "Completed":
      return "succeeded";
    case "Failed":
      return "failed";
    case "Canceled":
    case "Cancelled":
    case "Stopped":
      return "cancelled";
    case "Pending":
      return "queued";
    case "Running":
    default:
      return "running";
  }
}

function resourceName(id: string, collection: "containerApps" | "jobs" | "executions"): string {
  const marker = `/${collection}/`;
  const index = id.indexOf(marker);
  if (index === -1) return id;
  return decodeURIComponent(id.slice(index + marker.length).split("/")[0] ?? id);
}

function stringProviderOption(options: JobStatusSpec["providerOptions"], key: string): string | undefined {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

function jobExecutionIdentity(spec: JobStatusSpec | CancelJobSpec): { jobName: string; executionName: string } {
  const jobName = spec.id.includes("/jobs/") ? resourceName(spec.id, "jobs") : stringProviderOption(spec.providerOptions, "jobName");
  const executionName = spec.id.includes("/executions/") ? resourceName(spec.id, "executions") : spec.id;
  if (!jobName) {
    throw new AdapterExecutionError(
      "Azure Container Apps job execution operations require a full ARM execution id or providerOptions.jobName."
    );
  }
  return { jobName, executionName };
}

export function azureContainerApps(options: AzureContainerAppsAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => new AzureContainerAppsClient(options);
  return {
    name: adapter,
    provider,
    capabilities: azureContainerAppsCapabilities,
    raw: { subscriptionId: options.subscriptionId, resourceGroupName: options.resourceGroupName, location: options.location, environmentId: options.environmentId },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const client = getClient();
        const jobName = spec.name ?? `capsule-job-${Date.now().toString(36)}`;
        const job = await client.request<AzureResource>({ method: "PUT", path: client.resourcePath("jobs", jobName), body: jobBody(spec, options) });
        const execution = await client.request<AzureResource>({ method: "POST", path: client.resourcePath("jobs", jobName, "/start") });
        const id = execution.id ?? job.id ?? jobName;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command: Array.isArray(spec.command) ? spec.command : spec.command ? ["sh", "-lc", spec.command] : undefined,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Azure Container Apps job.run creates or updates a manual Container Apps Job, then starts an execution.",
                  "Execution logs and artifact collection are not implemented yet."
                ]
              },
              resource: { id, name: job.name ?? jobName, status: execution.properties?.runningStatus ?? job.properties?.provisioningState ?? "running" },
              metadata: { jobId: job.id, executionId: execution.id, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId }
            })
          : undefined;
        return { id, provider, status: "running", receipt };
      },
      status: async (spec: JobStatusSpec, context: AdapterContext): Promise<JobStatusResult> => {
        const startedAt = new Date();
        const client = getClient();
        const { jobName, executionName } = jobExecutionIdentity(spec);
        const execution = await client.request<AzureResource>({ path: client.jobExecutionPath(jobName, executionName) });
        const status = jobStatus(execution);
        const id = execution.id ?? spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.status",
              capabilityPath: "job.status",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Azure Container Apps job status is read from the ARM job execution resource."]
              },
              resource: { id, name: execution.name ?? executionName, status },
              metadata: { jobName, executionName, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId, execution }
            })
          : undefined;
        return {
          id,
          provider,
          status,
          receipt,
          metadata: { jobName, executionName, execution }
        };
      },
      cancel: async (spec: CancelJobSpec, context: AdapterContext): Promise<CancelJobResult> => {
        const startedAt = new Date();
        const client = getClient();
        const { jobName, executionName } = jobExecutionIdentity(spec);
        await client.request<unknown>({ method: "POST", path: client.jobExecutionPath(jobName, executionName, "/stop") });
        const id = spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.cancel",
              capabilityPath: "job.cancel",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Azure Container Apps job cancel maps to the ARM stop execution operation."]
              },
              resource: { id, name: executionName, status: "cancelling" },
              metadata: { jobName, executionName, reason: spec.reason, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId }
            })
          : undefined;
        return {
          id,
          provider,
          status: "cancelling",
          receipt,
          metadata: { jobName, executionName, reason: spec.reason }
        };
      }
    },
    service: {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const client = getClient();
        const resource = await client.request<AzureResource>({
          method: "PUT",
          path: client.resourcePath("containerApps", spec.name),
          body: serviceBody(spec, options)
        });
        const status = resourceStatus(resource);
        const id = resource.id ?? spec.name;
        const url = resource.properties?.configuration?.ingress?.fqdn ? `https://${resource.properties.configuration.ingress.fqdn}` : undefined;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.deploy",
              capabilityPath: "service.deploy",
              startedAt,
              image: spec.image,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Azure Container Apps service deploy is native through ARM createOrUpdate.",
                  "Ingress, registry, identity, secrets, and managed environment behavior remain Azure-specific.",
                  "Revision activate/deactivate APIs exist in ARM, but generic Capsule service rollback is not modeled by this adapter."
                ]
              },
              resource: { id, name: resource.name ?? spec.name, url, status },
              metadata: { provisioningState: resource.properties?.provisioningState, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId }
            })
          : undefined;
        return { id, provider, name: resource.name ?? spec.name, status, url, receipt };
      },
      status: async (spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult> => {
        const startedAt = new Date();
        const client = getClient();
        const name = resourceName(spec.id, "containerApps");
        const resource = await client.request<AzureResource>({ path: client.resourcePath("containerApps", name) });
        const status = resourceStatus(resource);
        const id = resource.id ?? spec.id;
        const url = resource.properties?.configuration?.ingress?.fqdn ? `https://${resource.properties.configuration.ingress.fqdn}` : undefined;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.status",
              capabilityPath: "service.status",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Azure Container Apps service status is read from the ARM Container App resource."]
              },
              resource: { id, name: resource.name ?? name, status, url },
              metadata: { resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId, resource }
            })
          : undefined;
        return { id, provider, name: resource.name ?? name, status, url, receipt, metadata: { resource } };
      },
      delete: async (spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService> => {
        const startedAt = new Date();
        const client = getClient();
        const name = resourceName(spec.id, "containerApps");
        await client.request<unknown>({ method: "DELETE", path: client.resourcePath("containerApps", name) });
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.delete",
              capabilityPath: "service.delete",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Azure Container Apps service deletion maps to the ARM Container Apps delete operation."]
              },
              resource: { id: spec.id, name, status: "deleted" },
              metadata: { reason: spec.reason, force: spec.force, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId }
            })
          : undefined;
        return { id: spec.id, provider, name, status: "deleted", receipt, metadata: { reason: spec.reason, force: spec.force } };
      }
    }
  };
}
