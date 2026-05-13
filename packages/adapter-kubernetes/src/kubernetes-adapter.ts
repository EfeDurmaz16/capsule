import * as k8s from "@kubernetes/client-node";
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
  type JobLogsResult,
  type JobLogsSpec,
  type JobRun,
  type JobRunStatus,
  type JobStatusResult,
  type JobStatusSpec,
  type LogEntry,
  type RunJobSpec,
  type ServiceDeployment,
  type ServiceLogsResult,
  type ServiceLogsSpec,
  type ServiceStatusResult,
  type ServiceStatusSpec
} from "@capsule/core";

interface KubernetesObject {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    labels?: Record<string, string>;
    deletionTimestamp?: string;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

interface KubernetesPodList {
  items?: KubernetesObject[];
  metadata?: Record<string, unknown>;
}

interface BatchApi {
  createNamespacedJob(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
  readNamespacedJob?(input: { namespace: string; name: string }): Promise<KubernetesObject>;
  deleteNamespacedJob?(input: { namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }): Promise<KubernetesObject>;
}

interface AppsApi {
  createNamespacedDeployment(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
  readNamespacedDeployment?(input: { namespace: string; name: string }): Promise<KubernetesObject>;
  deleteNamespacedDeployment?(input: { namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }): Promise<KubernetesObject>;
}

interface CoreApi {
  createNamespacedService(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
  readNamespacedService?(input: { namespace: string; name: string }): Promise<KubernetesObject>;
  deleteNamespacedService?(input: { namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }): Promise<KubernetesObject>;
  listNamespacedPod?(input: { namespace: string; labelSelector?: string }): Promise<KubernetesPodList>;
  readNamespacedPodLog?(input: {
    namespace: string;
    name: string;
    container?: string;
    follow?: boolean;
    sinceSeconds?: number;
    stream?: "Stdout" | "Stderr";
    tailLines?: number;
    timestamps?: boolean;
  }): Promise<string>;
}

interface KubernetesClients {
  batch: BatchApi;
  apps: AppsApi;
  core: CoreApi;
}

export interface KubernetesAdapterOptions {
  namespace?: string;
  kubeconfigPath?: string;
  context?: string;
  clients?: KubernetesClients;
}

const provider = "kubernetes";
const adapter = "kubernetes";

export const kubernetesCapabilities: CapabilityMap = {
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
    resources: "native"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "native",
    status: "native",
    logs: "native",
    url: "experimental",
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

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || `capsule-${Date.now()}`;
}

function labels(name: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/managed-by": "capsule",
    ...(extra ?? {})
  };
}

function normalizeCommand(command: string[] | string | undefined): { command?: string[]; args?: string[] } {
  if (!command) return {};
  const parts = typeof command === "string" ? ["sh", "-lc", command] : command;
  const [entrypoint, ...args] = parts;
  return { command: entrypoint ? [entrypoint] : undefined, args };
}

function env(envVars?: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(envVars ?? {}).map(([name, value]) => ({ name, value }));
}

function resources(resourcesInput?: { cpu?: number; memoryMb?: number }) {
  const limits: Record<string, string> = {};
  if (resourcesInput?.cpu !== undefined) limits.cpu = String(resourcesInput.cpu);
  if (resourcesInput?.memoryMb !== undefined) limits.memory = `${resourcesInput.memoryMb}Mi`;
  return Object.keys(limits).length > 0 ? { limits } : undefined;
}

function jobBody(name: string, spec: RunJobSpec) {
  const matchLabels = labels(name, spec.labels);
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name, labels: matchLabels },
    spec: {
      activeDeadlineSeconds: spec.timeoutMs ? Math.ceil(spec.timeoutMs / 1000) : undefined,
      backoffLimit: 0,
      template: {
        metadata: { labels: matchLabels },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "main",
              image: spec.image,
              ...normalizeCommand(spec.command),
              env: env(spec.env),
              resources: resources(spec.resources)
            }
          ]
        }
      }
    }
  };
}

function deploymentBody(name: string, namespace: string, spec: DeployServiceSpec) {
  if (!spec.image) {
    throw new AdapterExecutionError("Kubernetes service.deploy requires spec.image. Source deploy is not implemented.");
  }
  const matchLabels = labels(name, spec.labels);
  const replicas = spec.scale?.min ?? 1;
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace, labels: matchLabels },
    spec: {
      replicas,
      selector: { matchLabels },
      template: {
        metadata: { labels: matchLabels },
        spec: {
          containers: [
            {
              name: "main",
              image: spec.image,
              env: env(spec.env),
              resources: resources(spec.resources),
              ports: spec.ports?.map((port) => ({ containerPort: port.port, protocol: (port.protocol ?? "http") === "tcp" ? "TCP" : "TCP" })),
              readinessProbe: spec.healthcheck?.path ? { httpGet: { path: spec.healthcheck.path, port: spec.ports?.[0]?.port ?? 80 } } : undefined
            }
          ]
        }
      }
    }
  };
}

function serviceBody(name: string, namespace: string, spec: DeployServiceSpec) {
  const matchLabels = labels(name, spec.labels);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace, labels: matchLabels },
    spec: {
      selector: matchLabels,
      type: spec.ports?.some((port) => port.public) ? "LoadBalancer" : "ClusterIP",
      ports: (spec.ports?.length ? spec.ports : [{ port: 80, protocol: "http" as const }]).map((port) => ({
        port: port.port,
        targetPort: port.port,
        protocol: (port.protocol ?? "http") === "tcp" ? "TCP" : "TCP"
      }))
    }
  };
}

function clusterUrl(name: string, namespace: string, port?: number): string {
  return `http://${name}.${namespace}.svc.cluster.local${port ? `:${port}` : ""}`;
}

function firstServicePort(service: KubernetesObject, fallback?: number): number | undefined {
  const ports = service.spec?.ports;
  if (!Array.isArray(ports)) return fallback;
  const first = ports[0];
  if (!first || typeof first !== "object" || !("port" in first) || typeof first.port !== "number") return fallback;
  return first.port;
}

function serviceUrl(service: KubernetesObject, name: string, namespace: string, fallbackPort?: number): string {
  const port = firstServicePort(service, fallbackPort);
  const ingress = service.status?.loadBalancer;
  const entries =
    ingress && typeof ingress === "object" && "ingress" in ingress && Array.isArray(ingress.ingress) ? ingress.ingress : [];
  const first = entries[0];
  if (first && typeof first === "object") {
    if ("hostname" in first && typeof first.hostname === "string" && first.hostname.length > 0) {
      return `http://${first.hostname}${port ? `:${port}` : ""}`;
    }
    if ("ip" in first && typeof first.ip === "string" && first.ip.length > 0) {
      return `http://${first.ip}${port ? `:${port}` : ""}`;
    }
  }
  return clusterUrl(name, namespace, port);
}

function conditionIsTrue(condition: unknown, type: string): boolean {
  return Boolean(
    condition &&
      typeof condition === "object" &&
      "type" in condition &&
      condition.type === type &&
      "status" in condition &&
      condition.status === "True"
  );
}

function numericStatus(status: Record<string, unknown> | undefined, key: string): number {
  const value = status?.[key];
  return typeof value === "number" ? value : 0;
}

function jobStatus(job: KubernetesObject): JobRunStatus {
  if (job.metadata?.deletionTimestamp) return "cancelled";
  const conditions = Array.isArray(job.status?.conditions) ? job.status.conditions : [];
  if (conditions.some((condition) => conditionIsTrue(condition, "Complete"))) return "succeeded";
  if (conditions.some((condition) => conditionIsTrue(condition, "Failed"))) return "failed";
  if (numericStatus(job.status, "succeeded") > 0) return "succeeded";
  if (numericStatus(job.status, "failed") > 0) return "failed";
  if (numericStatus(job.status, "active") > 0) return "running";
  return "queued";
}

function serviceStatus(deployment: KubernetesObject): ServiceStatusResult["status"] {
  if (deployment.metadata?.deletionTimestamp) return "deleted";
  const conditions = Array.isArray(deployment.status?.conditions) ? deployment.status.conditions : [];
  if (conditions.some((condition) => conditionIsTrue(condition, "ReplicaFailure"))) return "failed";
  const desired = numericStatus(deployment.spec, "replicas") || 1;
  const ready = numericStatus(deployment.status, "readyReplicas");
  const available = numericStatus(deployment.status, "availableReplicas");
  if (ready >= desired && available >= desired) return "ready";
  return "deploying";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const input = record(value);
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== "string" || item.length === 0) return undefined;
    output[key] = item;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function matchLabelsFromSelector(spec: Record<string, unknown> | undefined): Record<string, string> | undefined {
  return stringRecord(record(record(spec?.selector)?.matchLabels));
}

function serviceSelector(service: KubernetesObject): Record<string, string> | undefined {
  return stringRecord(service.spec?.selector);
}

function labelSelector(matchLabels: Record<string, string>): string {
  return Object.entries(matchLabels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function containers(pod: KubernetesObject): string[] {
  const values = record(pod.spec)?.containers;
  if (!Array.isArray(values)) return [];
  return values.flatMap((container) => {
    const name = record(container)?.name;
    return typeof name === "string" && name.length > 0 ? [name] : [];
  });
}

function literalEnv(pods: KubernetesObject[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const pod of pods) {
    const podContainers = record(pod.spec)?.containers;
    if (!Array.isArray(podContainers)) continue;
    for (const container of podContainers) {
      const envVars = record(container)?.env;
      if (!Array.isArray(envVars)) continue;
      for (const envVar of envVars) {
        const item = record(envVar);
        if (typeof item?.name === "string" && typeof item.value === "string") {
          values[item.name] = item.value;
        }
      }
    }
  }
  return values;
}

function secondsSince(value: string | undefined, now = new Date()): number | undefined {
  if (!value) return undefined;
  const timestamp = parseTimestamp(value);
  if (Number.isNaN(timestamp)) {
    throw new AdapterExecutionError(`Invalid Kubernetes log since timestamp: ${value}`);
  }
  return Math.max(0, Math.ceil((now.getTime() - timestamp) / 1000));
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return timestamp;
  const normalized = value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2");
  return Date.parse(normalized);
}

function parseKubernetesLog(text: string, stream: LogEntry["stream"], fallbackTimestamp: string): LogEntry[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s(.*)$/);
      if (match && !Number.isNaN(parseTimestamp(match[1]))) {
        return { timestamp: match[1], stream, message: match[2] };
      }
      return { timestamp: fallbackTimestamp, stream, message: line };
    });
}

function filterUntil(logs: LogEntry[], until: string | undefined): LogEntry[] {
  if (!until) return logs;
  const cutoff = parseTimestamp(until);
  if (Number.isNaN(cutoff)) {
    throw new AdapterExecutionError(`Invalid Kubernetes log until timestamp: ${until}`);
  }
  return logs.filter((entry) => {
    const timestamp = parseTimestamp(entry.timestamp);
    return Number.isNaN(timestamp) || timestamp <= cutoff;
  });
}

function limitLogs(logs: LogEntry[], limit: number | undefined): LogEntry[] {
  if (limit === undefined) return logs;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new AdapterExecutionError("Kubernetes log limit must be a non-negative integer.");
  }
  if (limit === 0) return [];
  return logs.slice(-limit);
}

async function collectPodLogs(
  core: CoreApi,
  input: {
    namespace: string;
    selector: Record<string, string> | undefined;
    selectorSource: string;
    id: string;
    since?: string;
    until?: string;
    limit?: number;
    follow?: boolean;
    context: AdapterContext;
  }
): Promise<{ logs: LogEntry[]; metadata: Record<string, unknown> }> {
  if (!input.selector) {
    throw new AdapterExecutionError(`Kubernetes ${input.selectorSource} logs require a pod selector for ${input.id}.`);
  }
  const listNamespacedPod = requireCoreMethod(core, "listNamespacedPod");
  const readNamespacedPodLog = requireCoreMethod(core, "readNamespacedPodLog");
  const selector = labelSelector(input.selector);
  const podList = await listNamespacedPod.call(core, { namespace: input.namespace, labelSelector: selector });
  const pods = podList.items ?? [];
  const sinceSeconds = secondsSince(input.since);
  const fallbackTimestamp = new Date().toISOString();
  const logs: LogEntry[] = [];
  for (const pod of pods) {
    const podName = pod.metadata?.name;
    if (!podName) continue;
    const podContainers = containers(pod);
    const targets = podContainers.length > 0 ? podContainers : [undefined];
    for (const container of targets) {
      for (const [stream, kubernetesStream] of [
        ["stdout", "Stdout"],
        ["stderr", "Stderr"]
      ] as const) {
        const text = await readNamespacedPodLog.call(core, {
          namespace: input.namespace,
          name: podName,
          container,
          follow: input.follow,
          sinceSeconds,
          stream: kubernetesStream,
          tailLines: input.limit,
          timestamps: true
        });
        logs.push(...parseKubernetesLog(text, stream, fallbackTimestamp));
      }
    }
  }
  const redactionEnv = literalEnv(pods);
  const redactedLogs = redactLogEntries(filterUntil(logs, input.until), redactionEnv, input.context.policy);
  return {
    logs: limitLogs(redactedLogs, input.limit),
    metadata: {
      namespace: input.namespace,
      selector,
      selectorSource: input.selectorSource,
      podNames: pods.map((pod) => pod.metadata?.name).filter(Boolean),
      redactedFromPodEnv: Object.keys(redactionEnv).length > 0
    }
  };
}

function requireBatchMethod<K extends keyof BatchApi>(batch: BatchApi, method: K): NonNullable<BatchApi[K]> {
  const value = batch[method];
  if (typeof value !== "function") {
    throw new AdapterExecutionError(`Kubernetes Batch API client does not implement ${String(method)}.`);
  }
  return value;
}

function requireAppsMethod<K extends keyof AppsApi>(apps: AppsApi, method: K): NonNullable<AppsApi[K]> {
  const value = apps[method];
  if (typeof value !== "function") {
    throw new AdapterExecutionError(`Kubernetes Apps API client does not implement ${String(method)}.`);
  }
  return value;
}

function requireCoreMethod<K extends keyof CoreApi>(core: CoreApi, method: K): NonNullable<CoreApi[K]> {
  const value = core[method];
  if (typeof value !== "function") {
    throw new AdapterExecutionError(`Kubernetes Core API client does not implement ${String(method)}.`);
  }
  return value;
}

function defaultClients(options: KubernetesAdapterOptions): KubernetesClients {
  const config = new k8s.KubeConfig();
  if (options.kubeconfigPath) {
    config.loadFromFile(options.kubeconfigPath);
  } else {
    config.loadFromDefault();
  }
  if (options.context) {
    config.setCurrentContext(options.context);
  }
  return {
    batch: config.makeApiClient(k8s.BatchV1Api) as unknown as BatchApi,
    apps: config.makeApiClient(k8s.AppsV1Api) as unknown as AppsApi,
    core: config.makeApiClient(k8s.CoreV1Api) as unknown as CoreApi
  };
}

export function kubernetes(options: KubernetesAdapterOptions = {}): CapsuleAdapter {
  const namespace = options.namespace ?? "default";
  const getClients = () => options.clients ?? defaultClients(options);
  return {
    name: adapter,
    provider,
    capabilities: kubernetesCapabilities,
    raw: { namespace, context: options.context, kubeconfigPath: options.kubeconfigPath },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const name = normalizeName(spec.name ?? `capsule-job-${Date.now()}`);
        const created = await getClients().batch.createNamespacedJob({ namespace, body: jobBody(name, spec) });
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command: typeof spec.command === "string" ? ["sh", "-lc", spec.command] : spec.command,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Kubernetes Job creation is native.",
                  "Capsule does not claim cluster-level security; RBAC, admission control, runtime class, and network policy are cluster responsibilities.",
                  "This adapter creates the Job and records the Kubernetes resource; log collection is not implemented yet."
                ]
              },
              resource: { id: created.metadata?.name ?? name, name, status: "running" },
              metadata: { namespace, kubernetesName: created.metadata?.name ?? name, uid: created.metadata?.uid }
            })
          : undefined;
        return {
          id: created.metadata?.name ?? name,
          provider,
          status: "running",
          result: { exitCode: 0, stdout: "", stderr: "", logs: logsFromOutput("", ""), artifacts: [], receipt },
          receipt
        };
      },
      status: async (spec: JobStatusSpec): Promise<JobStatusResult> => {
        const batch = getClients().batch;
        const readNamespacedJob = requireBatchMethod(batch, "readNamespacedJob");
        const job = await readNamespacedJob.call(batch, { namespace, name: spec.id });
        const name = job.metadata?.name ?? spec.id;
        return {
          id: name,
          provider,
          status: jobStatus(job),
          metadata: { namespace, kubernetesName: name, uid: job.metadata?.uid, job }
        };
      },
      cancel: async (spec: CancelJobSpec): Promise<CancelJobResult> => {
        const batch = getClients().batch;
        const deleteNamespacedJob = requireBatchMethod(batch, "deleteNamespacedJob");
        const name = spec.id;
        const deletion = await deleteNamespacedJob.call(batch, {
          namespace,
          name,
          gracePeriodSeconds: 0,
          propagationPolicy: "Foreground",
          body: {
            apiVersion: "v1",
            kind: "DeleteOptions",
            gracePeriodSeconds: 0,
            propagationPolicy: "Foreground"
          }
        });
        return {
          id: deletion.metadata?.name ?? name,
          provider,
          status: "cancelling",
          metadata: {
            namespace,
            kubernetesName: deletion.metadata?.name ?? name,
            uid: deletion.metadata?.uid,
            reason: spec.reason,
            semantics: "delete-job-foreground",
            deletion
          }
        };
      },
      logs: async (spec: JobLogsSpec, context: AdapterContext): Promise<JobLogsResult> => {
        const startedAt = new Date();
        const clients = getClients();
        const readNamespacedJob = requireBatchMethod(clients.batch, "readNamespacedJob");
        const job = await readNamespacedJob.call(clients.batch, { namespace, name: spec.id });
        const name = job.metadata?.name ?? spec.id;
        const result = await collectPodLogs(clients.core, {
          namespace,
          selector: matchLabelsFromSelector(job.spec),
          selectorSource: "job.selector.matchLabels",
          id: name,
          since: spec.since,
          until: spec.until,
          limit: spec.limit,
          follow: spec.follow,
          context
        });
        const policy = context.evaluatePolicy();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.logs",
              capabilityPath: "job.logs",
              startedAt,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Kubernetes Job logs are collected from Pods matched by the Job selector.",
                  "Capsule redacts literal env values present on selected Pod specs when log redaction policy is enabled."
                ]
              },
              resource: { id: name, name, status: jobStatus(job) },
              metadata: { ...result.metadata, kubernetesName: name, uid: job.metadata?.uid }
            })
          : undefined;
        return { id: name, provider, logs: result.logs, metadata: result.metadata, receipt };
      }
    },
    service: {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const name = normalizeName(spec.name);
        const clients = getClients();
        const deployment = await clients.apps.createNamespacedDeployment({ namespace, body: deploymentBody(name, namespace, spec) });
        const service = await clients.core.createNamespacedService({ namespace, body: serviceBody(name, namespace, spec) });
        const url = serviceUrl(service, service.metadata?.name ?? name, namespace, spec.ports?.[0]?.port);
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
                  "Kubernetes Deployment and Service creation are native.",
                  "The returned URL is the in-cluster DNS name unless your cluster exposes the Service separately.",
                  "Capsule does not mutate ingress, certificates, external DNS, or cluster admission policy."
                ]
              },
              resource: { id: deployment.metadata?.uid ?? name, name, status: "deploying", url },
              metadata: { namespace, deploymentName: deployment.metadata?.name ?? name, serviceName: service.metadata?.name ?? name }
            })
          : undefined;
        return { id: deployment.metadata?.uid ?? name, provider, name, status: "deploying", url, receipt };
      },
      status: async (spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult> => {
        const startedAt = new Date();
        const clients = getClients();
        const readNamespacedDeployment = requireAppsMethod(clients.apps, "readNamespacedDeployment");
        const readNamespacedService = requireCoreMethod(clients.core, "readNamespacedService");
        const name = spec.id;
        const deployment = await readNamespacedDeployment.call(clients.apps, { namespace, name });
        const service = await readNamespacedService.call(clients.core, { namespace, name });
        const resolvedName = deployment.metadata?.name ?? service.metadata?.name ?? name;
        const url = serviceUrl(service, service.metadata?.name ?? resolvedName, namespace);
        const status = serviceStatus(deployment);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.status",
              capabilityPath: "service.status",
              startedAt,
              policy: context.evaluatePolicy(),
              resource: { id: resolvedName, name: resolvedName, status, url },
              metadata: { namespace, deploymentName: deployment.metadata?.name ?? name, serviceName: service.metadata?.name ?? name }
            })
          : undefined;
        return {
          id: resolvedName,
          provider,
          name: resolvedName,
          status,
          url,
          metadata: { namespace, deployment, service },
          receipt
        };
      },
      delete: async (spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService> => {
        const startedAt = new Date();
        const clients = getClients();
        const deleteNamespacedDeployment = requireAppsMethod(clients.apps, "deleteNamespacedDeployment");
        const deleteNamespacedService = requireCoreMethod(clients.core, "deleteNamespacedService");
        const name = spec.id;
        const deleteOptions = {
          apiVersion: "v1",
          kind: "DeleteOptions",
          gracePeriodSeconds: 0,
          propagationPolicy: "Foreground"
        };
        const deployment = await deleteNamespacedDeployment.call(clients.apps, {
          namespace,
          name,
          gracePeriodSeconds: 0,
          propagationPolicy: "Foreground",
          body: deleteOptions
        });
        const service = await deleteNamespacedService.call(clients.core, {
          namespace,
          name,
          gracePeriodSeconds: 0,
          propagationPolicy: "Foreground",
          body: deleteOptions
        });
        const resolvedName = deployment.metadata?.name ?? service.metadata?.name ?? name;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.delete",
              capabilityPath: "service.delete",
              startedAt,
              policy: context.evaluatePolicy(),
              resource: { id: resolvedName, name: resolvedName, status: "deleted" },
              metadata: {
                namespace,
                deploymentName: deployment.metadata?.name ?? name,
                serviceName: service.metadata?.name ?? name,
                reason: spec.reason
              }
            })
          : undefined;
        return {
          id: resolvedName,
          provider,
          name: resolvedName,
          status: "deleted",
          metadata: { namespace, deployment, service, reason: spec.reason },
          receipt
        };
      },
      logs: async (spec: ServiceLogsSpec, context: AdapterContext): Promise<ServiceLogsResult> => {
        const startedAt = new Date();
        const clients = getClients();
        const readNamespacedService = requireCoreMethod(clients.core, "readNamespacedService");
        const service = await readNamespacedService.call(clients.core, { namespace, name: spec.id });
        const name = service.metadata?.name ?? spec.id;
        const result = await collectPodLogs(clients.core, {
          namespace,
          selector: serviceSelector(service),
          selectorSource: "service.spec.selector",
          id: name,
          since: spec.since,
          until: spec.until,
          limit: spec.limit,
          follow: spec.follow,
          context
        });
        const policy = context.evaluatePolicy();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.logs",
              capabilityPath: "service.logs",
              startedAt,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Kubernetes Service logs are collected from Pods matched by the Service selector.",
                  "Capsule redacts literal env values present on selected Pod specs when log redaction policy is enabled."
                ]
              },
              resource: { id: name, name },
              metadata: { ...result.metadata, serviceName: name, uid: service.metadata?.uid }
            })
          : undefined;
        return { id: name, provider, name, logs: result.logs, metadata: result.metadata, receipt };
      }
    }
  };
}
