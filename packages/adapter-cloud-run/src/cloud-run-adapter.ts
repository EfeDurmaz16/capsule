import {
  AdapterExecutionError,
  logsFromOutput,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployServiceSpec,
  type JobRun,
  type RunJobSpec,
  type ServiceDeployment
} from "@capsule/core";
import { CloudRunClient, type CloudRunClientOptions, type CloudRunOperation } from "./cloud-run-client.js";

export interface CloudRunAdapterOptions extends CloudRunClientOptions {}

const provider = "cloud-run";
const adapter = "cloud-run";

export const cloudRunCapabilities: CapabilityMap = {
  sandbox: {
    create: "unsupported",
    exec: "unsupported",
    fileRead: "unsupported",
    fileWrite: "unsupported",
    fileList: "unsupported",
    destroy: "unsupported"
  },
  job: {
    run: "native",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "native",
    env: "native",
    resources: "experimental"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "unsupported",
    status: "native",
    logs: "unsupported",
    url: "native",
    scale: "native",
    rollback: "unsupported",
    healthcheck: "experimental",
    secrets: "unsupported"
  },
  edge: {
    deploy: "unsupported",
    rollback: "unsupported",
    routes: "unsupported"
  },
  database: {
    branchCreate: "unsupported",
    branchDelete: "unsupported",
    connectionString: "unsupported"
  },
  preview: {
    create: "unsupported",
    destroy: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    urls: "unsupported"
  },
  machine: {
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }
};

function normalizeCommand(command: string[] | string | undefined): { command?: string[]; args?: string[] } {
  if (!command) return {};
  const parts = typeof command === "string" ? ["sh", "-lc", command] : command;
  const [entrypoint, ...args] = parts;
  return { command: entrypoint ? [entrypoint] : undefined, args };
}

function env(env?: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(env ?? {}).map(([name, value]) => ({ name, value }));
}

function resources(resources?: { cpu?: number; memoryMb?: number }): Record<string, string> | undefined {
  const limits: Record<string, string> = {};
  if (resources?.cpu !== undefined) limits.cpu = String(resources.cpu);
  if (resources?.memoryMb !== undefined) limits.memory = `${resources.memoryMb}Mi`;
  return Object.keys(limits).length > 0 ? limits : undefined;
}

function timeout(timeoutMs?: number): string | undefined {
  return timeoutMs === undefined ? undefined : `${Math.ceil(timeoutMs / 1000)}s`;
}

function container(image: string, command: string[] | string | undefined, envVars: Record<string, string> | undefined, limits?: Record<string, string>) {
  return {
    image,
    ...normalizeCommand(command),
    env: env(envVars),
    ...(limits ? { resources: { limits } } : {})
  };
}

function jobBody(spec: RunJobSpec) {
  return {
    labels: spec.labels,
    template: {
      template: {
        timeout: timeout(spec.timeoutMs),
        containers: [container(spec.image, spec.command, spec.env, resources(spec.resources))]
      }
    }
  };
}

function serviceBody(spec: DeployServiceSpec) {
  if (!spec.image) {
    throw new AdapterExecutionError("Cloud Run service.deploy requires spec.image. Source deploy is not implemented.");
  }
  return {
    labels: spec.labels,
    template: {
      scaling: {
        minInstanceCount: spec.scale?.min,
        maxInstanceCount: spec.scale?.max
      },
      containers: [
        {
          ...container(spec.image, spec.healthcheck?.command, spec.env, resources(spec.resources)),
          ports: spec.ports?.[0] ? [{ containerPort: spec.ports[0].port, name: spec.ports[0].protocol === "tcp" ? "tcp1" : "http1" }] : undefined,
          startupProbe: spec.healthcheck?.path ? { httpGet: { path: spec.healthcheck.path } } : undefined
        }
      ]
    }
  };
}

function operationStatus(operation: CloudRunOperation): "succeeded" | "failed" | "running" {
  if (operation.error) return "failed";
  if (operation.done) return "succeeded";
  return "running";
}

function serviceUrl(service: Record<string, unknown>, operation: CloudRunOperation): string | undefined {
  const uri = service.uri;
  if (typeof uri === "string") return uri;
  const response = operation.response;
  if (response && typeof response === "object" && "uri" in response && typeof response.uri === "string") return response.uri;
  return undefined;
}

export function cloudRun(options: CloudRunAdapterOptions): CapsuleAdapter {
  const getClient = () => new CloudRunClient(options);
  return {
    name: adapter,
    provider,
    capabilities: cloudRunCapabilities,
    raw: { baseUrl: options.baseUrl ?? "https://run.googleapis.com/v2", projectId: options.projectId, location: options.location },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const client = getClient();
        const id = spec.name ?? `capsule-job-${Date.now()}`;
        const create = await client.createJob(id, jobBody(spec));
        const run = await client.runJob(client.resource("jobs", id));
        const operation = await client.waitOperation(run);
        const status = operationStatus(operation);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command: typeof spec.command === "string" ? ["sh", "-lc", spec.command] : spec.command,
              exitCode: status === "succeeded" ? 0 : undefined,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Cloud Run job execution is native.",
                  "Cloud Run Admin API does not return stdout/stderr; use Cloud Logging integration for logs."
                ]
              },
              resource: { id: id, name: client.resource("jobs", id), status },
              metadata: { createOperation: create.name, runOperation: run.name, operation }
            })
          : undefined;
        return {
          id,
          provider,
          status,
          result:
            status === "succeeded"
              ? { exitCode: 0, stdout: "", stderr: "", logs: logsFromOutput("", ""), artifacts: [], receipt }
              : undefined,
          receipt
        };
      }
    },
    service: {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const client = getClient();
        const create = await client.createService(spec.name, serviceBody(spec));
        const operation = await client.waitOperation(create);
        const status = operation.error ? "failed" : operation.done ? "ready" : "deploying";
        const serviceName = client.resource("services", spec.name);
        const service = status === "ready" ? await client.getService(serviceName) : {};
        const url = serviceUrl(service, operation);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.deploy",
              capabilityPath: "service.deploy",
              startedAt,
              image: spec.image,
              source: spec.source,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Cloud Run service deployment is native.",
                  "This adapter does not change IAM policies or make services public."
                ]
              },
              resource: { id: spec.name, name: serviceName, status, url },
              metadata: { operation: operation.name, labels: spec.labels }
            })
          : undefined;
        return { id: spec.name, provider, name: spec.name, status, url, receipt };
      }
    }
  };
}
