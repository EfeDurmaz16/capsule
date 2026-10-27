import { randomBytes } from "node:crypto";
import * as k8s from "@kubernetes/client-node";
import {
  AdapterExecutionError,
  asProviderError,
  capsuleOperationTags,
  providerRuntimeMetadata,
  CaptureBudget,
  CaptureLimitError,
  mapWithConcurrency,
  resolveCaptureBounds,
  type AdapterContext,
  type CaptureBounds,
  type CaptureTruncation,
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
} from "@capsule-sdk/core";

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
  deleteNamespacedJob?(input: {
    namespace: string;
    name: string;
    gracePeriodSeconds?: number;
    propagationPolicy?: string;
    body?: unknown;
  }): Promise<KubernetesObject>;
}

interface AppsApi {
  createNamespacedDeployment(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
  readNamespacedDeployment?(input: { namespace: string; name: string }): Promise<KubernetesObject>;
  deleteNamespacedDeployment?(input: {
    namespace: string;
    name: string;
    gracePeriodSeconds?: number;
    propagationPolicy?: string;
    body?: unknown;
  }): Promise<KubernetesObject>;
}

interface CoreApi {
  createNamespacedService(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
  readNamespacedService?(input: { namespace: string; name: string }): Promise<KubernetesObject>;
  deleteNamespacedService?(input: {
    namespace: string;
    name: string;
    gracePeriodSeconds?: number;
    propagationPolicy?: string;
    body?: unknown;
  }): Promise<KubernetesObject>;
  listNamespacedPod?(input: { namespace: string; labelSelector?: string; limit?: number; _continue?: string }): Promise<KubernetesPodList>;
  readNamespacedPodLog?(input: {
    namespace: string;
    name: string;
    container?: string;
    follow?: boolean;
    sinceSeconds?: number;
    stream?: "Stdout" | "Stderr";
    tailLines?: number;
    limitBytes?: number;
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
const adapterVersion = "0.1.1";

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

const dnsLabel = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// Lowercases, replaces characters Kubernetes does not allow and truncates to 63 characters. Trimming
// runs after truncation too, so the result never ends with a dash. A name with no usable characters is
// rejected instead of silently replaced, so callers can always find the resource they named.
function kubernetesName(value: string, operation: string, options: { rfc1035?: boolean } = {}): string {
  const name = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  if (!dnsLabel.test(name)) {
    throw new AdapterExecutionError(`Kubernetes ${operation} name ${JSON.stringify(value)} does not contain a valid Kubernetes name.`);
  }
  if (options.rfc1035 && !/^[a-z]/.test(name)) {
    throw new AdapterExecutionError(`Kubernetes ${operation} name ${JSON.stringify(value)} must start with a letter because Service names are RFC 1035 labels.`);
  }
  return name;
}

// Generated names carry random bits so two runs in the same millisecond never collide.
function generatedJobName(): string {
  return `capsule-job-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
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
  const matchLabels = labels(name, {
    ...(spec.labels ?? {}),
    ...(capsuleOperationTags({ idempotencyKey: spec.idempotencyKey, capabilityPath: "job.run" }) ?? {})
  });
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
  const matchLabels = labels(name, {
    ...(spec.labels ?? {}),
    ...(capsuleOperationTags({ idempotencyKey: spec.idempotencyKey, capabilityPath: "service.deploy" }) ?? {})
  });
  // Only what the manifest really expresses is accepted: a fixed replica count and an HTTP readiness
  // path. A command healthcheck or an autoscaling range would otherwise be dropped silently.
  if (spec.healthcheck?.command !== undefined) {
    throw new AdapterExecutionError("Kubernetes service.deploy supports only healthcheck.path (HTTP readiness probe); healthcheck.command is not implemented.");
  }
  const replicas = spec.scale?.min ?? 1;
  if (spec.scale?.max !== undefined && spec.scale.max !== replicas) {
    throw new AdapterExecutionError(
      "Kubernetes service.deploy sets a fixed replica count; scale.max must be omitted or equal scale.min because autoscaling (HPA) is not implemented."
    );
  }
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

interface ServicePortSpec {
  port: number;
  protocol: "http" | "tcp";
  public?: boolean;
}

// Kubernetes requires a name on every port of a multi-port Service, unique within the Service and a
// valid IANA service name (lowercase alphanumerics and dashes, at most 15 characters). Ports are
// validated before any API call so an invalid spec never leaves a Deployment behind.
function servicePorts(spec: DeployServiceSpec): Array<ServicePortSpec & { name: string }> {
  const ports: ServicePortSpec[] = spec.ports?.length
    ? spec.ports.map((port) => ({ port: port.port, protocol: port.protocol ?? "http", public: port.public }))
    : [{ port: 80, protocol: "http" }];
  const seen = new Set<number>();
  return ports.map((port) => {
    if (!Number.isInteger(port.port) || port.port < 1 || port.port > 65535) {
      throw new AdapterExecutionError(`Kubernetes service.deploy port ${String(port.port)} must be an integer between 1 and 65535.`);
    }
    if (seen.has(port.port)) {
      throw new AdapterExecutionError(`Kubernetes service.deploy port ${port.port} is listed more than once.`);
    }
    seen.add(port.port);
    return { ...port, name: `${port.protocol}-${port.port}` };
  });
}

function serviceBody(name: string, namespace: string, spec: DeployServiceSpec) {
  const matchLabels = labels(name, {
    ...(spec.labels ?? {}),
    ...(capsuleOperationTags({ idempotencyKey: spec.idempotencyKey, capabilityPath: "service.deploy" }) ?? {})
  });
  const ports = servicePorts(spec);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace, labels: matchLabels },
    spec: {
      selector: matchLabels,
      type: ports.some((port) => port.public) ? "LoadBalancer" : "ClusterIP",
      ports: ports.map((port) => ({
        name: port.name,
        port: port.port,
        targetPort: port.port,
        protocol: "TCP"
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
  const entries = ingress && typeof ingress === "object" && "ingress" in ingress && Array.isArray(ingress.ingress) ? ingress.ingress : [];
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

function foregroundDeleteOptions() {
  return {
    apiVersion: "v1",
    kind: "DeleteOptions",
    gracePeriodSeconds: 0,
    propagationPolicy: "Foreground"
  };
}

async function deleteDeploymentForeground(apps: AppsApi, namespace: string, name: string): Promise<void> {
  const deleteNamespacedDeployment = requireAppsMethod(apps, "deleteNamespacedDeployment");
  await deleteNamespacedDeployment.call(apps, {
    namespace,
    name,
    gracePeriodSeconds: 0,
    propagationPolicy: "Foreground",
    body: foregroundDeleteOptions()
  });
}

function conditionIsTrue(condition: unknown, type: string): boolean {
  return Boolean(
    condition && typeof condition === "object" && "type" in condition && condition.type === type && "status" in condition && condition.status === "True"
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

function kubernetesReceiptMetadata(providerApiVersion: string, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...providerRuntimeMetadata({ providerApiVersion, adapterVersion }),
    ...metadata
  };
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

function labelSelectorFromJobSpec(spec: Record<string, unknown> | undefined): string | undefined {
  return labelSelectorFromSelector(record(spec?.selector));
}

function serviceSelector(service: KubernetesObject): string | undefined {
  const selector = stringRecord(service.spec?.selector);
  return selector ? labelSelector(selector) : undefined;
}

function labelSelector(matchLabels: Record<string, string>): string {
  return Object.entries(matchLabels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function selectorRequirement(value: unknown): string | undefined {
  const item = record(value);
  const key = typeof item?.key === "string" ? item.key : undefined;
  const operator = typeof item?.operator === "string" ? item.operator : undefined;
  if (!key || !operator) return undefined;
  const values = Array.isArray(item?.values) ? item.values.filter((entry): entry is string => typeof entry === "string") : [];
  switch (operator) {
    case "In":
      return `${key} in (${values.join(",")})`;
    case "NotIn":
      return `${key} notin (${values.join(",")})`;
    case "Exists":
      return key;
    case "DoesNotExist":
      return `!${key}`;
    default:
      throw new AdapterExecutionError(`Unsupported Kubernetes label selector operator: ${operator}`);
  }
}

function labelSelectorFromSelector(selector: Record<string, unknown> | undefined): string | undefined {
  if (!selector) return undefined;
  const parts: string[] = [];
  const matchLabels = stringRecord(selector.matchLabels);
  if (matchLabels) parts.push(labelSelector(matchLabels));
  const expressions = selector.matchExpressions;
  if (Array.isArray(expressions)) {
    parts.push(...expressions.flatMap((expression) => selectorRequirement(expression) ?? []));
  }
  return parts.filter(Boolean).join(",") || undefined;
}

function containers(pod: KubernetesObject): string[] {
  const values = record(pod.spec)?.containers;
  if (!Array.isArray(values)) return [];
  return values.flatMap((container) => {
    const name = record(container)?.name;
    return typeof name === "string" && name.length > 0 ? [name] : [];
  });
}

// Every literal env value on every selected container, not one value per name: during a rollout two
// pods can carry different values for the same variable and both must be redacted.
function literalEnvValues(pods: KubernetesObject[]): Set<string> {
  const values = new Set<string>();
  for (const pod of pods) {
    const podContainers = record(pod.spec)?.containers;
    if (!Array.isArray(podContainers)) continue;
    for (const container of podContainers) {
      const envVars = record(container)?.env;
      if (!Array.isArray(envVars)) continue;
      for (const envVar of envVars) {
        const item = record(envVar);
        if (typeof item?.name === "string" && typeof item.value === "string" && item.value.length > 0) {
          values.add(item.value);
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

function parseKubernetesLog(text: string, stream: LogEntry["stream"], fallbackTimestamp: string, source?: string): LogEntry[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s(.*)$/);
      const base =
        match && !Number.isNaN(parseTimestamp(match[1]))
          ? { timestamp: match[1], stream, message: match[2] }
          : { timestamp: fallbackTimestamp, stream, message: line };
      return source ? { ...base, source } : base;
    });
}

// Comparable instant with nanosecond precision. Kubernetes log timestamps are RFC3339 with up to nine
// fractional digits, which Date.parse would round to milliseconds and so misorder close entries.
function timestampKey(value: string): { seconds: number; nanos: number } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? undefined : { seconds: Math.floor(millis / 1000), nanos: (millis % 1000) * 1_000_000 };
  }
  const millis = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(millis)) return undefined;
  return { seconds: millis / 1000, nanos: Number((match[2] ?? "").padEnd(9, "0")) };
}

// Global oldest-to-newest order across every pod and container, independent of the order the provider
// listed pods in or the order concurrent reads finished. Ties fall back to source name, then to the
// read target's position in the pod list, then to the original line order, so the result is
// deterministic.
interface OrderedLog {
  entry: LogEntry;
  key: { seconds: number; nanos: number } | undefined;
  target: number;
  line: number;
}

function compareOrderedLogs(left: OrderedLog, right: OrderedLog): number {
  const a = left.key;
  const b = right.key;
  if (a && b) {
    if (a.seconds !== b.seconds) return a.seconds - b.seconds;
    if (a.nanos !== b.nanos) return a.nanos - b.nanos;
  } else if (a || b) {
    return a ? 1 : -1;
  }
  const sourceOrder = (left.entry.source ?? "").localeCompare(right.entry.source ?? "");
  if (sourceOrder !== 0) return sourceOrder;
  return left.target !== right.target ? left.target - right.target : left.line - right.line;
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

function redactLiteralEnvValues(logs: LogEntry[], values: Set<string>, context: AdapterContext): LogEntry[] {
  if (!context.policy.secrets?.redactFromLogs) return logs;
  // Longest first so a value that contains another value is replaced whole.
  const secrets = [...values].sort((left, right) => right.length - left.length);
  if (secrets.length === 0) return logs;
  return logs.map((entry) => ({
    ...entry,
    message: secrets.reduce((message, secret) => message.split(secret).join("[REDACTED]"), entry.message)
  }));
}

function validateLogLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new AdapterExecutionError("Kubernetes log limit must be a non-negative integer.");
  }
}

const textEncoder = new TextEncoder();

// Merges a new source into the kept window and keeps only the `cap` newest entries.
function mergeNewest(kept: OrderedLog[], incoming: OrderedLog[], cap: number): OrderedLog[] {
  const merged = [...kept, ...incoming].sort(compareOrderedLogs);
  return merged.length > cap ? merged.slice(-cap) : merged;
}

async function collectPodLogs(
  core: CoreApi,
  input: {
    namespace: string;
    selector: string | undefined;
    selectorSource: string;
    id: string;
    since?: string;
    until?: string;
    limit?: number;
    follow?: boolean;
    cursor?: string;
    bounds?: CaptureBounds;
    context: AdapterContext;
  }
): Promise<{ logs: LogEntry[]; nextCursor?: string; truncation: CaptureTruncation; metadata: Record<string, unknown> }> {
  if (!input.selector) {
    throw new AdapterExecutionError(`Kubernetes ${input.selectorSource} logs require a pod selector for ${input.id}.`);
  }
  if (input.follow) {
    throw new AdapterExecutionError("Kubernetes logs follow mode is not supported yet; call logs again to fetch newer entries.");
  }
  validateLogLimit(input.limit);
  const bounds = resolveCaptureBounds(input.bounds);
  const sinceSeconds = secondsSince(input.since);
  if (input.until !== undefined && Number.isNaN(parseTimestamp(input.until))) {
    throw new AdapterExecutionError(`Invalid Kubernetes log until timestamp: ${input.until}`);
  }
  const listNamespacedPod = requireCoreMethod(core, "listNamespacedPod");
  const readNamespacedPodLog = requireCoreMethod(core, "readNamespacedPodLog");
  // The caller's limit is the requested page size; bounds.maxRecords is a ceiling that is reported as
  // truncation when it cuts the result. Every per-source read is a bounded tail (tailLines) with a
  // server-side byte cap (limitBytes), so no single source can return an unbounded transcript.
  const cap = Math.min(input.limit ?? bounds.maxRecords, bounds.maxRecords);
  const capFromBounds = input.limit === undefined || input.limit > bounds.maxRecords;
  // The deadline bounds provider reads; the byte and record budget is applied afterwards to what arrived.
  const deadlineAt = Date.now() + bounds.deadlineMs;
  const budget = new CaptureBudget({ ...bounds, deadlineMs: Number.MAX_SAFE_INTEGER, overflow: "truncate" });
  // Pagination rides the pod list continue token: one page of matched pods per call, their logs
  // fanned out with at most bounds.concurrency reads in flight and tagged with source.
  const podList = await listNamespacedPod.call(core, { namespace: input.namespace, labelSelector: input.selector, _continue: input.cursor });
  const pods = podList.items ?? [];
  const nextCursor = typeof podList.metadata?.["continue"] === "string" && podList.metadata["continue"] ? (podList.metadata["continue"] as string) : undefined;
  const fallbackTimestamp = new Date().toISOString();
  const targets = pods.flatMap((pod) => {
    const podName = pod.metadata?.name;
    if (!podName) return [];
    const podContainers = containers(pod);
    return (podContainers.length > 0 ? podContainers : [undefined]).map((container) => ({ podName, container }));
  });

  let kept: OrderedLog[] = [];
  let candidates = 0;
  let sourceAtTailCap = false;
  let sourceAtByteCap = false;
  let deadlineHit = false;
  await mapWithConcurrency(targets, bounds.concurrency, async ({ podName, container }, target) => {
    if (cap === 0) return;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      deadlineHit = true;
      return;
    }
    const read = readNamespacedPodLog.call(core, {
      namespace: input.namespace,
      name: podName,
      container,
      sinceSeconds,
      tailLines: cap,
      limitBytes: bounds.maxBytes,
      timestamps: true
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), remainingMs);
    });
    // A read that outlives the deadline is abandoned, not cancelled: the injected API has no abort hook.
    read.catch(() => undefined);
    const text = await Promise.race([read, expired]).finally(() => clearTimeout(timer));
    if (text === undefined) {
      deadlineHit = true;
      return;
    }
    let body = text;
    if (textEncoder.encode(text).byteLength >= bounds.maxBytes) {
      // limitBytes stopped the stream; the last line may be cut mid-way, so drop it.
      sourceAtByteCap = true;
      const lastNewline = body.lastIndexOf("\n");
      body = lastNewline === -1 ? "" : body.slice(0, lastNewline + 1);
    }
    const entries = filterUntil(parseKubernetesLog(body, "stdout", fallbackTimestamp, podName), input.until);
    if (entries.length >= cap) sourceAtTailCap = true;
    candidates += entries.length;
    kept = mergeNewest(
      kept,
      entries.map((entry, line) => ({ entry, key: timestampKey(entry.timestamp), target, line })),
      cap
    );
  });

  const redactionValues = literalEnvValues(pods);
  const redacted = redactLiteralEnvValues(
    kept.map((item) => item.entry),
    redactionValues,
    input.context
  );
  // Aggregate byte budget, filled newest first so a cut drops the oldest entries.
  const selected: LogEntry[] = [];
  for (let index = redacted.length - 1; index >= 0; index -= 1) {
    const entry = redacted[index]!;
    if (!budget.takeRecord(textEncoder.encode(entry.message).byteLength)) break;
    selected.push(entry);
  }
  selected.reverse();

  const budgetTruncation = budget.truncation();
  let truncation: CaptureTruncation = budgetTruncation;
  if (!budgetTruncation.truncated) {
    const reason = deadlineHit
      ? ({ reason: "deadline", limit: bounds.deadlineMs } as const)
      : sourceAtByteCap
        ? ({ reason: "bytes", limit: bounds.maxBytes } as const)
        : capFromBounds && (candidates > cap || sourceAtTailCap)
          ? ({ reason: "records", limit: bounds.maxRecords } as const)
          : undefined;
    if (reason) truncation = { ...budgetTruncation, truncated: true, ...reason };
  }
  if (truncation.truncated && bounds.overflow === "error") {
    throw new CaptureLimitError(`Kubernetes ${input.selectorSource} logs exceeded capture bounds: ${truncation.reason}.`, truncation);
  }
  return {
    logs: selected,
    nextCursor,
    truncation,
    metadata: {
      namespace: input.namespace,
      selector: input.selector,
      selectorSource: input.selectorSource,
      podNames: pods.map((pod) => pod.metadata?.name).filter(Boolean),
      redactedFromPodEnv: redactionValues.size > 0
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

function rethrowKubernetesError(error: unknown): never {
  throw asProviderError(error, "Kubernetes API request failed.");
}

// ponytail: one Proxy over each API client reclassifies every method rejection, instead of wrapping
// the dozen individual createNamespaced*/read*/delete* call sites by hand.
function classifyKubernetesErrors<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        try {
          const result = method.apply(target, args);
          return result instanceof Promise ? result.catch(rethrowKubernetesError) : result;
        } catch (error) {
          rethrowKubernetesError(error);
        }
      };
    }
  });
}

export function kubernetes(options: KubernetesAdapterOptions = {}): CapsuleAdapter {
  const namespace = options.namespace ?? "default";
  const getClients = (): KubernetesClients => {
    const clients = options.clients ?? defaultClients(options);
    return {
      batch: classifyKubernetesErrors(clients.batch),
      apps: classifyKubernetesErrors(clients.apps),
      core: classifyKubernetesErrors(clients.core)
    };
  };
  return {
    name: adapter,
    provider,
    capabilities: kubernetesCapabilities,
    raw: { namespace, context: options.context, kubeconfigPath: options.kubeconfigPath },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const name = spec.name === undefined ? generatedJobName() : kubernetesName(spec.name, "job.run");
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
              metadata: kubernetesReceiptMetadata("batch/v1", { namespace, kubernetesName: created.metadata?.name ?? name, uid: created.metadata?.uid })
            })
          : undefined;
        // The Job was only created; no exit code exists yet. Omit result until job.status observes a
        // terminal state instead of returning a placeholder that looks like a passed workload.
        return {
          id: created.metadata?.name ?? name,
          provider,
          status: "running",
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
          selector: labelSelectorFromJobSpec(job.spec),
          selectorSource: "job.spec.selector",
          id: name,
          since: spec.since,
          until: spec.until,
          limit: spec.limit,
          follow: spec.follow,
          cursor: spec.cursor,
          bounds: spec.bounds,
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
                  "Capsule reads combined Pod logs without alpha split-stream parameters.",
                  "Capsule redacts literal env values present on selected Pod specs when log redaction policy is enabled.",
                  "Kubernetes follow-mode log streaming is intentionally rejected until Capsule exposes bounded streaming semantics."
                ]
              },
              resource: { id: name, name, status: jobStatus(job) },
              metadata: kubernetesReceiptMetadata("batch/v1+v1", { ...result.metadata, kubernetesName: name, uid: job.metadata?.uid })
            })
          : undefined;
        return { id: name, provider, logs: result.logs, truncation: result.truncation, nextCursor: result.nextCursor, metadata: result.metadata, receipt };
      }
    },
    service: {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const name = kubernetesName(spec.name, "service.deploy", { rfc1035: true });
        // Build and validate both manifests before the first API call.
        const deploymentManifest = deploymentBody(name, namespace, spec);
        const serviceManifest = serviceBody(name, namespace, spec);
        const clients = getClients();
        const deployment = await clients.apps.createNamespacedDeployment({ namespace, body: deploymentManifest });
        const deploymentName = deployment.metadata?.name ?? name;
        let service: KubernetesObject;
        try {
          service = await clients.core.createNamespacedService({ namespace, body: serviceManifest });
        } catch (error) {
          await deleteDeploymentForeground(clients.apps, namespace, deploymentName).catch(() => undefined);
          throw error;
        }
        const serviceName = service.metadata?.name ?? name;
        const url = serviceUrl(service, serviceName, namespace, spec.ports?.[0]?.port);
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
              resource: { id: deploymentName, name: deploymentName, status: "deploying", url },
              metadata: kubernetesReceiptMetadata("apps/v1+v1", {
                namespace,
                deploymentName,
                serviceName,
                deploymentUid: deployment.metadata?.uid,
                serviceUid: service.metadata?.uid
              })
            })
          : undefined;
        return { id: deploymentName, provider, name: deploymentName, status: "deploying", url, receipt };
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
              metadata: kubernetesReceiptMetadata("apps/v1+v1", {
                namespace,
                deploymentName: deployment.metadata?.name ?? name,
                serviceName: service.metadata?.name ?? name
              })
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
        const deleteOptions = foregroundDeleteOptions();
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
              metadata: kubernetesReceiptMetadata("apps/v1+v1", {
                namespace,
                deploymentName: deployment.metadata?.name ?? name,
                serviceName: service.metadata?.name ?? name,
                reason: spec.reason
              })
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
          cursor: spec.cursor,
          bounds: spec.bounds,
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
                  "Capsule reads combined Pod logs without alpha split-stream parameters.",
                  "Capsule redacts literal env values present on selected Pod specs when log redaction policy is enabled.",
                  "Kubernetes follow-mode log streaming is intentionally rejected until Capsule exposes bounded streaming semantics."
                ]
              },
              resource: { id: name, name },
              metadata: kubernetesReceiptMetadata("v1", { ...result.metadata, serviceName: name, uid: service.metadata?.uid })
            })
          : undefined;
        return { id: name, provider, name, logs: result.logs, truncation: result.truncation, nextCursor: result.nextCursor, metadata: result.metadata, receipt };
      }
    }
  };
}
