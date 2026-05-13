import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployServiceSpec,
  type JobRun,
  type RunJobSpec,
  type ServiceDeployment
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
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "experimental",
    env: "native",
    resources: "native"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    url: "native",
    scale: "native",
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
  const state = resource.properties?.provisioningState;
  if (state === "Succeeded") return "ready";
  if (state === "Failed") return "failed";
  return "deploying";
}

export function azureContainerApps(options: AzureContainerAppsAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => new AzureContainerAppsClient(options);
  return {
    name: adapter,
    provider,
    capabilities: azureContainerAppsCapabilities,
    raw: { subscriptionId: options.subscriptionId, resourceGroupName: options.resourceGroupName, location: options.location, environmentId: options.environmentId },
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
                  "Ingress, revision, registry, identity, secrets, and managed environment behavior remain Azure-specific."
                ]
              },
              resource: { id, name: resource.name ?? spec.name, url, status },
              metadata: { provisioningState: resource.properties?.provisioningState, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId }
            })
          : undefined;
        return { id, provider, name: resource.name ?? spec.name, status, url, receipt };
      }
    },
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
                  "Execution polling, logs, cancellation, and artifact collection are not implemented yet."
                ]
              },
              resource: { id, name: job.name ?? jobName, status: execution.properties?.runningStatus ?? job.properties?.provisioningState ?? "running" },
              metadata: { jobId: job.id, executionId: execution.id, resourceGroupName: client.resourceGroupName, subscriptionId: client.subscriptionId }
            })
          : undefined;
        return { id, provider, status: "running", receipt };
      }
    }
  };
}
