import {
  AdapterExecutionError,
  logsFromOutput,
  redactLogEntries,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CancelJobResult,
  type CancelJobSpec,
  type DeletedService,
  type DeleteServiceSpec,
  type DeployServiceSpec,
  type JobStatusResult,
  type JobStatusSpec,
  type JobLogsResult,
  type JobLogsSpec,
  type JobRun,
  type LogEntry,
  type RollbackServiceSpec,
  type RunJobSpec,
  type ServiceDeployment,
  type ServiceLogsResult,
  type ServiceLogsSpec,
  type ServiceStatusResult,
  type ServiceStatusSpec,
  type UpdateServiceSpec
} from "@capsule/core";
import {
  CloudRunClient,
  type CloudRunClientOptions,
  type CloudRunExecution,
  type CloudLoggingEntry,
  type CloudRunOperation,
  type CloudRunService
} from "./cloud-run-client.js";

export interface CloudRunAdapterOptions extends CloudRunClientOptions {
  logRedactionEnv?: Record<string, string>;
}

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
    logs: "native",
    artifacts: "unsupported",
    timeout: "native",
    env: "native",
    resources: "experimental"
  },
  service: {
    deploy: "native",
    update: "native",
    delete: "native",
    status: "native",
    logs: "native",
    url: "native",
    scale: "native",
    rollback: "native",
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

function serviceUpdateBody(name: string, spec: UpdateServiceSpec): { body: Record<string, unknown>; updateMask: string[] } {
  if (spec.source) {
    throw new AdapterExecutionError("Cloud Run service.update from source is not implemented. Provide an image for revision updates.");
  }
  const limits = resources(spec.resources);
  const hasContainerUpdate = Boolean(spec.image ?? spec.env ?? spec.resources ?? spec.ports ?? spec.healthcheck);
  const body: Record<string, unknown> = { name };
  const updateMask: string[] = [];

  if (spec.labels) {
    body.labels = spec.labels;
    updateMask.push("labels");
  }

  if (hasContainerUpdate || spec.scale) {
    body.template = {
      ...(spec.scale ? { scaling: { minInstanceCount: spec.scale.min, maxInstanceCount: spec.scale.max } } : {}),
      ...(hasContainerUpdate
        ? {
            containers: [
              {
                ...(spec.image ? { image: spec.image } : {}),
                ...normalizeCommand(spec.healthcheck?.command),
                ...(spec.env ? { env: env(spec.env) } : {}),
                ...(limits ? { resources: { limits } } : {}),
                ...(spec.ports?.[0] ? { ports: [{ containerPort: spec.ports[0].port, name: spec.ports[0].protocol === "tcp" ? "tcp1" : "http1" }] } : {}),
                ...(spec.healthcheck?.path ? { startupProbe: { httpGet: { path: spec.healthcheck.path } } } : {})
              }
            ]
          }
        : {})
    };
    updateMask.push(...(spec.scale ? ["template.scaling"] : []), ...(hasContainerUpdate ? ["template.containers"] : []));
  }

  if (!body.template) {
    throw new AdapterExecutionError("Cloud Run service.update requires a revision template change such as image, env, resources, ports, healthcheck, or scale.");
  }

  return { body, updateMask };
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

function isService(value: unknown): value is CloudRunService {
  return Boolean(value && typeof value === "object" && "name" in value && typeof value.name === "string");
}

function serviceUrl(service: Partial<CloudRunService>, operation: CloudRunOperation): string | undefined {
  const uri = service.uri;
  if (typeof uri === "string") return uri;
  const response = operation.response;
  if (response && typeof response === "object" && "uri" in response && typeof response.uri === "string") return response.uri;
  return undefined;
}

function serviceStatus(service: CloudRunService): ServiceDeployment["status"] {
  if (service.deleteTime) return "deleted";
  if (service.reconciling) return "deploying";
  if (service.terminalCondition?.state === "CONDITION_FAILED") return "failed";
  if (service.terminalCondition?.state === "CONDITION_SUCCEEDED") return "ready";
  const readyCondition = service.conditions?.find((condition) => condition.type === "Ready");
  if (readyCondition?.state === "CONDITION_FAILED") return "failed";
  if (readyCondition?.state === "CONDITION_SUCCEEDED") return "ready";
  if (service.latestReadyRevision && service.latestReadyRevision === service.latestCreatedRevision) return "ready";
  return "deploying";
}

function serviceOperationStatus(operation: CloudRunOperation): ServiceDeployment["status"] {
  if (operation.error) return "failed";
  if (operation.done) return "ready";
  if (isService(operation.response)) return serviceStatus(operation.response);
  return "deploying";
}

function serviceName(client: CloudRunClient, id: string): string {
  return id.startsWith("projects/") ? id : client.resource("services", id);
}

function providerBoolean(options: UpdateServiceSpec["providerOptions"], key: string, fallback: boolean): boolean {
  const value = options?.[key];
  return typeof value === "boolean" ? value : fallback;
}

async function previousRevision(client: CloudRunClient, name: string, service: CloudRunService): Promise<string> {
  const revisions = (await client.listRevisions(name)).revisions ?? [];
  const [revision] = revisions
    .filter((candidate) => !candidate.deleteTime && candidate.name !== service.latestCreatedRevision && candidate.name !== service.latestReadyRevision)
    .sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""));
  if (!revision?.name) {
    throw new AdapterExecutionError("Cloud Run rollback requires spec.revision because no previous revision could be selected from the service revision list.");
  }
  return revision.name;
}

function resourceLeaf(id: string, collection: "jobs" | "services" | "executions"): string {
  const marker = `/${collection}/`;
  const index = id.indexOf(marker);
  if (index === -1) return id;
  return id.slice(index + marker.length).split("/")[0] ?? id;
}

function loggingValue(value: string): string {
  return JSON.stringify(value);
}

function loggingTimeRange(spec: { since?: string; until?: string }): string[] {
  return [
    ...(spec.since ? [`timestamp>=${loggingValue(spec.since)}`] : []),
    ...(spec.until ? [`timestamp<=${loggingValue(spec.until)}`] : [])
  ];
}

function jobLogFilter(client: CloudRunClient, spec: JobLogsSpec): string {
  const jobName = resourceLeaf(spec.id, "jobs");
  const executionName = spec.id.includes("/executions/") ? resourceLeaf(spec.id, "executions") : undefined;
  return [
    'resource.type="cloud_run_job"',
    `resource.labels.project_id=${loggingValue(client.projectId)}`,
    `resource.labels.location=${loggingValue(client.location)}`,
    `resource.labels.job_name=${loggingValue(jobName)}`,
    ...(executionName ? [`labels.execution_name=${loggingValue(executionName)}`] : []),
    ...loggingTimeRange(spec)
  ].join(" AND ");
}

function serviceLogFilter(client: CloudRunClient, spec: ServiceLogsSpec): string {
  const name = resourceLeaf(spec.id, "services");
  return [
    'resource.type="cloud_run_revision"',
    `resource.labels.project_id=${loggingValue(client.projectId)}`,
    `resource.labels.location=${loggingValue(client.location)}`,
    `resource.labels.service_name=${loggingValue(name)}`,
    ...loggingTimeRange(spec)
  ].join(" AND ");
}

function logEntryMessage(entry: CloudLoggingEntry): string {
  if (typeof entry.textPayload === "string") return entry.textPayload;
  if (entry.jsonPayload !== undefined) return typeof entry.jsonPayload === "string" ? entry.jsonPayload : JSON.stringify(entry.jsonPayload);
  if (entry.protoPayload !== undefined) return typeof entry.protoPayload === "string" ? entry.protoPayload : JSON.stringify(entry.protoPayload);
  return "";
}

function logEntryStream(entry: CloudLoggingEntry): LogEntry["stream"] {
  const logName = entry.logName ?? "";
  if (logName.endsWith("/logs/run.googleapis.com%2Fstdout") || logName.endsWith("/logs/stdout")) return "stdout";
  if (logName.endsWith("/logs/run.googleapis.com%2Fstderr") || logName.endsWith("/logs/stderr")) return "stderr";
  return "system";
}

function normalizeLogEntries(entries: CloudLoggingEntry[] | undefined): LogEntry[] {
  return (entries ?? []).map((entry) => ({
    timestamp: entry.timestamp ?? entry.receiveTimestamp ?? new Date(0).toISOString(),
    stream: logEntryStream(entry),
    message: logEntryMessage(entry)
  }));
}

async function fetchLogs(
  client: CloudRunClient,
  spec: JobLogsSpec | ServiceLogsSpec,
  context: AdapterContext,
  filter: string,
  redactionEnv: Record<string, string> | undefined
): Promise<LogEntry[]> {
  if (spec.follow) {
    throw new AdapterExecutionError("Cloud Run logs follow is not supported by Cloud Logging entries:list. Call logs again to fetch newer entries.");
  }
  const response = await client.listLogEntries({
    resourceNames: [`projects/${client.projectId}`],
    filter,
    orderBy: "timestamp desc",
    pageSize: spec.limit
  });
  return redactLogEntries(normalizeLogEntries(response.entries), redactionEnv, context.policy);
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
      },
      logs: async (spec: JobLogsSpec, context: AdapterContext): Promise<JobLogsResult> => {
        const startedAt = new Date();
        const client = getClient();
        const filter = jobLogFilter(client, spec);
        const logs = await fetchLogs(client, spec, context, filter, options.logRedactionEnv);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.logs",
              capabilityPath: "job.logs",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Cloud Run job logs are read through Cloud Logging entries:list."]
              },
              resource: { id: spec.id, name: resourceLeaf(spec.id, "jobs") },
              metadata: { filter, resourceNames: [`projects/${client.projectId}`], orderBy: "timestamp desc", pageSize: spec.limit }
            })
          : undefined;
        return { id: spec.id, provider, logs, receipt, metadata: { filter } };
      }
    },
    service: {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const client = getClient();
        const create = await client.createService(spec.name, serviceBody(spec));
        const operation = await client.waitOperation(create);
        const status = serviceOperationStatus(operation);
        const serviceName = client.resource("services", spec.name);
        const service = status === "ready" ? await client.getService(serviceName) : isService(operation.response) ? operation.response : {};
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
        return { id: spec.name, provider, name: spec.name, status, url, receipt, metadata: { operation, service } };
      },
      status: async (spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult> => {
        const startedAt = new Date();
        const client = getClient();
        const name = serviceName(client, spec.id);
        const service = await client.getService(name);
        const status = serviceStatus(service);
        const url = service.uri;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.status",
              capabilityPath: "service.status",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Cloud Run service status is read from the Admin API service resource."]
              },
              resource: { id: spec.id, name: service.name, status, url },
              metadata: { service }
            })
          : undefined;
        return { id: spec.id, provider, name: service.name, status, url, receipt, metadata: { service } };
      },
      update: async (spec: UpdateServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const client = getClient();
        const name = serviceName(client, spec.id);
        const { body, updateMask } = serviceUpdateBody(name, spec);
        const patch = await client.updateService(name, body, updateMask, {
          forceNewRevision: providerBoolean(spec.providerOptions, "forceNewRevision", true)
        });
        const operation = await client.waitOperation(patch);
        const status = serviceOperationStatus(operation);
        const service = status === "ready" ? await client.getService(name) : isService(operation.response) ? operation.response : { name };
        const url = serviceUrl(service, operation);
        const revision = service.latestReadyRevision ?? service.latestCreatedRevision;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.update",
              capabilityPath: "service.update",
              startedAt,
              image: spec.image,
              source: spec.source,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Cloud Run service update is native through services.patch.",
                  "forceNewRevision defaults to true so image tag re-pushes can produce a new revision."
                ]
              },
              resource: { id: spec.id, name, status, url },
              metadata: { operation: operation.name, operationResource: operation, updateMask, revision }
            })
          : undefined;
        return { id: spec.id, provider, name, status, url, receipt, metadata: { operation, service, updateMask, revision } };
      },
      rollback: async (spec: RollbackServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const client = getClient();
        const name = serviceName(client, spec.id);
        const service = await client.getService(name);
        const revision = spec.revision ?? (await previousRevision(client, name, service));
        const patch = await client.updateService(
          name,
          {
            name,
            traffic: [
              {
                type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                revision,
                percent: 100
              }
            ]
          },
          ["traffic"],
          { forceNewRevision: false }
        );
        const operation = await client.waitOperation(patch);
        const status = serviceOperationStatus(operation);
        const updated = status === "ready" ? await client.getService(name) : isService(operation.response) ? operation.response : service;
        const url = serviceUrl(updated, operation);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.rollback",
              capabilityPath: "service.rollback",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Cloud Run service rollback is native traffic migration to an existing revision."]
              },
              resource: { id: spec.id, name, status, url },
              metadata: { operation: operation.name, operationResource: operation, revision }
            })
          : undefined;
        return { id: spec.id, provider, name, status, url, receipt, metadata: { operation, service: updated, revision } };
      },
      delete: async (spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService> => {
        const startedAt = new Date();
        const client = getClient();
        const name = serviceName(client, spec.id);
        const operation = await client.deleteService(name);
        const waited = await client.waitOperation(operation);
        if (waited.error) {
          throw new AdapterExecutionError("Cloud Run service deletion failed.", { operation: waited });
        }
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.delete",
              capabilityPath: "service.delete",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Cloud Run service deletion is native through the Admin API."]
              },
              resource: { id: spec.id, name, status: "deleted" },
              metadata: { operation: waited.name, operationResource: waited }
            })
          : undefined;
        return { id: spec.id, provider, name, status: "deleted", receipt };
      },
      logs: async (spec: ServiceLogsSpec, context: AdapterContext): Promise<ServiceLogsResult> => {
        const startedAt = new Date();
        const client = getClient();
        const filter = serviceLogFilter(client, spec);
        const logs = await fetchLogs(client, spec, context, filter, options.logRedactionEnv);
        const name = serviceName(client, spec.id);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.logs",
              capabilityPath: "service.logs",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["Cloud Run service logs are read through Cloud Logging entries:list."]
              },
              resource: { id: spec.id, name },
              metadata: { filter, resourceNames: [`projects/${client.projectId}`], orderBy: "timestamp desc", pageSize: spec.limit }
            })
          : undefined;
        return { id: spec.id, provider, name, logs, receipt, metadata: { filter } };
      }
    }
  };
}
