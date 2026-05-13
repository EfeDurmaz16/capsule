import {
  AdapterExecutionError,
  logsFromOutput,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CancelJobResult,
  type CancelJobSpec,
  type DeployServiceSpec,
  type JobStatusResult,
  type JobStatusSpec,
  type JobRun,
  type RunJobSpec,
  type ServiceDeployment
} from "@capsule/core";
import { CloudRunClient, type CloudRunClientOptions, type CloudRunExecution, type CloudRunOperation } from "./cloud-run-client.js";

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
    status: "native",
    cancel: "native",
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
    status: "unsupported",
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

function isExecution(value: unknown): value is CloudRunExecution {
  return Boolean(value && typeof value === "object" && "name" in value && typeof value.name === "string");
}

function executionStatus(execution: CloudRunExecution): JobRun["status"] {
  switch (execution.completionStatus) {
    case "EXECUTION_SUCCEEDED":
      return "succeeded";
    case "EXECUTION_FAILED":
      return "failed";
    case "EXECUTION_CANCELLED":
      return "cancelled";
    case "EXECUTION_PENDING":
      return "queued";
    case "EXECUTION_RUNNING":
      return "running";
    case "COMPLETION_STATUS_UNSPECIFIED":
    case undefined:
      break;
  }
  if (execution.reconciling || (execution.runningCount ?? 0) > 0) return "running";
  if ((execution.cancelledCount ?? 0) > 0) return "cancelled";
  if ((execution.failedCount ?? 0) > 0) return "failed";
  if (execution.taskCount !== undefined && execution.succeededCount !== undefined && execution.succeededCount >= execution.taskCount) return "succeeded";
  return "queued";
}

function operationStatus(operation: CloudRunOperation): JobRun["status"] {
  if (operation.error) return "failed";
  if (isExecution(operation.response)) return executionStatus(operation.response);
  if (operation.done) return "succeeded";
  return "running";
}

function executionName(operation: CloudRunOperation, fallback: string): string {
  return isExecution(operation.response) ? operation.response.name : fallback;
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
        const runId = executionName(operation, client.resource("jobs", id));
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
              resource: { id: runId, name: runId, status },
              metadata: { createOperation: create.name, runOperation: run.name, operation }
            })
          : undefined;
        return {
          id: runId,
          provider,
          status,
          result:
            status === "succeeded"
              ? { exitCode: 0, stdout: "", stderr: "", logs: logsFromOutput("", ""), artifacts: [], receipt }
              : undefined,
          receipt
        };
      },
      status: async (spec: JobStatusSpec): Promise<JobStatusResult> => {
        const client = getClient();
        const execution = await client.getExecution(spec.id);
        return {
          id: execution.name,
          provider,
          status: executionStatus(execution),
          metadata: { execution }
        };
      },
      cancel: async (spec: CancelJobSpec): Promise<CancelJobResult> => {
        const client = getClient();
        const execution = await client.cancelExecution(spec.id);
        const status = executionStatus(execution) === "cancelled" ? "cancelled" : "cancelling";
        return {
          id: execution.name,
          provider,
          status,
          metadata: { execution, reason: spec.reason }
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
