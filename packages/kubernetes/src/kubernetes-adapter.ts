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
  CleanupFailureError,
  PartialEffectsError,
  PendingOperationError,
  observeUntilTerminal,
  providerErrorStatus,
  resourceLocator,
  type AdapterContext,
  type CaptureBounds,
  type CleanupOutcome,
  type ResourceLocator,
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
  readNamespacedDeployment?(input: { namespace: string; name: string }, options?: KubernetesRequestOptions): Promise<KubernetesObject>;
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
  readNamespacedService?(input: { namespace: string; name: string }, options?: KubernetesRequestOptions): Promise<KubernetesObject>;
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

/**
 * Per-request options of the @kubernetes/client-node 1.x API methods. Capsule passes only a request
 * middleware that attaches an AbortSignal, so a deadline cancels the HTTP request instead of leaving it
 * running. Injected clients may ignore it; Capsule still stops waiting at the deadline.
 */
type KubernetesRequestOptions = k8s.ConfigurationOptions<k8s.ObservableMiddleware>;

// The client has no signal parameter. Its HTTP library sends RequestContext.getSignal() to fetch, and a
// request middleware is the only place to set it. The generated API classes hand per-request options to
// their Observable layer unwrapped, so pre and post return the client's Observable, as the client's own
// setHeaderOptions does (a Promise-returning middleware fails there). "append" keeps the middleware the
// client was built with; the default "replace" would drop it.
function abortableRequest(signal: AbortSignal): KubernetesRequestOptions {
  return {
    middleware: [
      {
        pre: (request) => {
          request.setSignal(signal);
          return new k8s.Observable(Promise.resolve(request));
        },
        post: (response) => new k8s.Observable(Promise.resolve(response))
      }
    ],
    middlewareMergeStrategy: "append"
  };
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
  /**
   * Injected API clients, for example from KubeConfig.makeApiClient. Reads that a deadline bounds (the
   * service.delete observation) get a second argument: per-request options whose middleware attaches
   * the deadline's AbortSignal, so the installed client cancels the request. A client that ignores it is
   * abandoned at the deadline instead.
   */
  clients?: KubernetesClients;
  /**
   * Client-side budget in milliseconds for observing that an accepted foreground DELETE has finished
   * (the object is gone, after finalizers ran). Default 120000. When it expires, service.delete throws
   * PendingOperationError instead of reporting deleted, and an observation GET still in flight is
   * cancelled.
   */
  operationDeadlineMs?: number;
  /** Delay between deletion observations in milliseconds. Default 1000. */
  operationPollIntervalMs?: number;
  /**
   * Reread the kubeconfig and rebuild API clients for every operation, as earlier versions did. By
   * default the kubeconfig is parsed once per adapter on first use and the clients are reused; the
   * client library still applies authentication (including exec-plugin token refresh) per request.
   * Enable this when the kubeconfig file or its current context can change during the adapter's life.
   */
  reloadKubeconfigPerOperation?: boolean;
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
    throw new AdapterExecutionError(
      `Kubernetes ${operation} name ${JSON.stringify(value)} must start with a letter because Service names are RFC 1035 labels.`
    );
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

type ResourceKind = "deployment" | "service";

interface DeleteAttempt {
  kind: ResourceKind;
  /** absent: already gone or deleted immediately; accepted: DELETE accepted, object still terminating; failed: request failed. */
  state: "absent" | "accepted" | "failed";
  response?: KubernetesObject;
  error?: unknown;
}

// A DELETE that removed the object at once returns a Status object. A foreground DELETE that still has
// finalizers or dependents to process returns the object itself with a deletionTimestamp: it is
// accepted, not finished.
function deletedImmediately(response: KubernetesObject | undefined): boolean {
  const value = record(response);
  return value?.kind === "Status" && value.status === "Success";
}

async function requestForegroundDelete(kind: ResourceKind, remove: () => Promise<KubernetesObject>): Promise<DeleteAttempt> {
  try {
    const response = await remove();
    return { kind, state: deletedImmediately(response) ? "absent" : "accepted", response };
  } catch (error) {
    if (providerErrorStatus(error) === 404) return { kind, state: "absent" };
    return { kind, state: "failed", error };
  }
}

function deleteRequest(namespace: string, name: string) {
  return { namespace, name, gracePeriodSeconds: 0, propagationPolicy: "Foreground", body: foregroundDeleteOptions() };
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

// /^(\d{4}-\d{2}-\d{2}T\S+)\s(.*)$/ without the capture groups: test() and search() return a boolean
// and an index, so a line costs no match array (PERF-05). The prefix has no whitespace, so the first
// whitespace in a matching line ends the timestamp, exactly where the capturing form split it.
const timestampedLine = /^\d{4}-\d{2}-\d{2}T\S+\s.*$/;
const whitespace = /\s/;

function parseKubernetesLog(text: string, stream: LogEntry["stream"], fallbackTimestamp: string, source?: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line) continue;
    let timestamp = fallbackTimestamp;
    let message = line;
    if (timestampedLine.test(line)) {
      const end = line.search(whitespace);
      const candidate = line.slice(0, end);
      if (!Number.isNaN(parseTimestamp(candidate))) {
        timestamp = candidate;
        message = line.slice(end + 1);
      }
    }
    entries.push(source ? { timestamp, stream, message, source } : { timestamp, stream, message });
  }
  return entries;
}

// Comparable instant with nanosecond precision. Kubernetes log timestamps are RFC3339 with up to nine
// fractional digits, which Date.parse would round to milliseconds and so misorder close entries.
// Builds the ordering record for one entry; seconds is NaN when the timestamp has no comparable instant.
function orderedLog(entry: LogEntry, target: number, line: number): OrderedLog {
  const seconds = utcTimestampSeconds(entry.timestamp);
  if (seconds !== undefined) return { entry, seconds, nanos: utcNanos, target, line };
  const key = generalTimestampKey(entry.timestamp);
  return { entry, seconds: key ? key.seconds : Number.NaN, nanos: key ? key.nanos : 0, target, line };
}

// The whole second ("YYYY-MM-DDTHH:MM:SSZ") of the last UTC timestamp and its Date.parse value; log lines
// of one source often share it. Built by concatenation, so it holds no reference into a log body.
let lastSecond = "";
let lastSecondMillis = Number.NaN;
// Fraction of the last timestamp utcTimestampSeconds accepted, in nanoseconds (kept out of a return
// object so that ordering thousands of lines allocates nothing per line).
let utcNanos = 0;

const maxTimerDelayMs = 2_147_483_647;

const utcDigitPositions = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];

const digitAt = (value: string, index: number): boolean => {
  const code = value.charCodeAt(index);
  return code >= 48 && code <= 57;
};

// Fast path for the form the kubelet writes, "YYYY-MM-DDTHH:MM:SS[.fraction]Z", with no regular
// expression match objects (PERF-05). It gives exactly what generalTimestampKey gives for that form and
// undefined for anything else, which then takes the general path.
function utcTimestampSeconds(value: string): number | undefined {
  const zone = value.length - 1;
  if (zone < 19 || value.charCodeAt(zone) !== 90 /* Z */) return undefined;
  for (let position = 0; position < utcDigitPositions.length; position += 1) {
    if (!digitAt(value, utcDigitPositions[position]!)) return undefined;
  }
  if (value[4] !== "-" || value[7] !== "-" || value[10] !== "T" || value[13] !== ":" || value[16] !== ":") return undefined;
  let nanos = 0;
  if (zone > 19) {
    const digits = zone - 20;
    if (value[19] !== "." || digits < 1 || digits > 9) return undefined;
    for (let index = 20; index < zone; index += 1) {
      if (!digitAt(value, index)) return undefined;
      nanos = nanos * 10 + (value.charCodeAt(index) - 48);
    }
    nanos *= 10 ** (9 - digits);
  }
  if (!sameSecond(value, lastSecond)) {
    lastSecond = `${value.slice(0, 19)}Z`;
    lastSecondMillis = Date.parse(lastSecond);
  }
  if (Number.isNaN(lastSecondMillis)) return undefined;
  utcNanos = nanos;
  return lastSecondMillis / 1000;
}

function sameSecond(value: string, second: string): boolean {
  if (second.length !== 20) return false;
  for (let index = 0; index < 19; index += 1) {
    if (value.charCodeAt(index) !== second.charCodeAt(index)) return false;
  }
  return true;
}

function generalTimestampKey(value: string): { seconds: number; nanos: number } | undefined {
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
  /** NaN when the timestamp has no comparable instant; such entries sort before all others. */
  seconds: number;
  nanos: number;
  target: number;
  line: number;
}

function compareOrderedLogs(left: OrderedLog, right: OrderedLog): number {
  const a = !Number.isNaN(left.seconds);
  const b = !Number.isNaN(right.seconds);
  if (a && b) {
    if (left.seconds !== right.seconds) return left.seconds - right.seconds;
    if (left.nanos !== right.nanos) return left.nanos - right.nanos;
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
  // The entries were parsed by this collection and nothing else holds them yet, so the redacted message
  // replaces the original in place instead of in a copy of every entry.
  for (let entryIndex = 0; entryIndex < logs.length; entryIndex += 1) {
    const entry = logs[entryIndex]!;
    let message = entry.message;
    // Same replacements in the same order as splitting and joining on every value (a literal
    // replaceAll); a value that does not occur in the message as it stands is skipped. Index loops:
    // this runs entries x values times, mostly before the code is optimized, where for...of allocates.
    for (let index = 0; index < secrets.length; index += 1) {
      const secret = secrets[index]!;
      if (message.includes(secret)) message = message.replaceAll(secret, "[REDACTED]");
    }
    entry.message = message;
  }
  return logs;
}

function validateLogLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new AdapterExecutionError("Kubernetes log limit must be a non-negative integer.");
  }
}

// Keeps the `cap` newest entries of everything added. With a total order (compareOrderedLogs is one:
// target and line are unique), trimming once the buffer passes twice the cap keeps exactly the entries a
// sort after every source kept, with about one sort per `cap` entries instead of one per source of a
// growing array (PERF-05). Exported for its unit test only.
export class NewestWindow<T> {
  private entries: T[] = [];

  constructor(
    private readonly cap: number,
    private readonly compare: (left: T, right: T) => number
  ) {}

  add(incoming: T[]): void {
    for (let index = 0; index < incoming.length; index += 1) this.entries.push(incoming[index]!);
    if (this.entries.length > 2 * this.cap) this.trim();
  }

  /** The kept entries, oldest first. */
  result(): T[] {
    this.trim();
    return this.entries;
  }

  private trim(): void {
    this.entries.sort(this.compare);
    if (this.entries.length > this.cap) this.entries = this.entries.slice(this.entries.length - this.cap);
  }
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

  const newest = new NewestWindow<OrderedLog>(cap, compareOrderedLogs);
  let candidates = 0;
  let sourceAtTailCap = false;
  let sourceAtByteCap = false;
  let untilWindowShort = false;
  let deadlineHit = false;
  // One bounded read: a tail of `tailLines` lines with a server-side byte cap. Resolves undefined when
  // the client deadline expires first.
  const readTail = async (podName: string, container: string | undefined, tailLines: number): Promise<string | undefined> => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return undefined;
    const read = readNamespacedPodLog.call(core, {
      namespace: input.namespace,
      name: podName,
      container,
      sinceSeconds,
      tailLines,
      limitBytes: bounds.maxBytes,
      timestamps: true
    });
    // A read that outlives the deadline is abandoned, not cancelled: the injected API has no abort hook.
    read.catch(() => undefined);
    return await Promise.race([read, deadlineReached]);
  };
  // One deadline timer for every read instead of one per read (PERF-05). Node caps timer delays at
  // 2^31 - 1 ms and fires a longer one after 1 ms, so a longer deadline waits for the largest delay.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineReached = new Promise<undefined>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(undefined), Math.min(Math.max(0, deadlineAt - Date.now()), maxTimerDelayMs));
  });
  try {
    await mapWithConcurrency(targets, bounds.concurrency, async ({ podName, container }, target) => {
      if (cap === 0) return;
      // Kubelet seeks to the start of the tail and then counts limitBytes forward, so a tail larger than
      // maxBytes comes back as its OLDEST part. When that happens, read again with a shorter tail (the
      // number of complete lines that fitted, halving after a few attempts) until the newest lines fit.
      // Every read stays bounded by maxBytes and the attempt count is logarithmic in the tail length.
      let tailLines = cap;
      let body: string | undefined;
      for (let attempt = 0; ; attempt += 1) {
        const text = await readTail(podName, container, tailLines);
        if (text === undefined) {
          deadlineHit = true;
          return;
        }
        if (Buffer.byteLength(text, "utf8") < bounds.maxBytes) {
          body = text;
          break;
        }
        // limitBytes stopped the stream; the last line may be cut mid-way, so drop it.
        sourceAtByteCap = true;
        const lastNewline = text.lastIndexOf("\n");
        const complete = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
        const completeLines = complete === "" ? 0 : complete.split("\n").length - 1;
        if (tailLines <= 1) {
          // Even the newest single line does not fit in maxBytes; keep only what arrived complete.
          body = complete;
          break;
        }
        const shorter = attempt < 3 && completeLines > 0 ? Math.min(completeLines, tailLines - 1) : Math.floor(tailLines / 2);
        tailLines = Math.max(1, completeLines > 0 ? Math.min(shorter, completeLines) : shorter);
      }
      const raw = parseKubernetesLog(body, "stdout", fallbackTimestamp, podName);
      const entries = filterUntil(raw, input.until);
      // The tail was full, so older lines exist that were not read. With `until`, those older lines may be
      // exactly the ones the caller asked for, so a window that filters down below the cap is incomplete
      // whatever the caller's limit was.
      const fullTail = raw.length >= tailLines;
      if (fullTail) sourceAtTailCap = true;
      if (fullTail && input.until !== undefined && entries.length < cap) untilWindowShort = true;
      candidates += entries.length;
      newest.add(entries.map((entry, line) => orderedLog(entry, target, line)));
    });
  } finally {
    clearTimeout(deadlineTimer);
  }
  const kept = newest.result();

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
    if (!budget.takeRecord(Buffer.byteLength(entry.message, "utf8"))) break;
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
        : untilWindowShort
          ? ({ reason: "records", limit: cap } as const)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  // Lazily built once per adapter. A failed kubeconfig load is not cached, so the next operation
  // retries it. Injected clients are wrapped but never replaced.
  let cachedClients: KubernetesClients | undefined;
  const getClients = (): KubernetesClients => {
    if (cachedClients) return cachedClients;
    const clients = options.clients ?? defaultClients(options);
    const classified = {
      batch: classifyKubernetesErrors(clients.batch),
      apps: classifyKubernetesErrors(clients.apps),
      core: classifyKubernetesErrors(clients.core)
    };
    if (!options.reloadKubeconfigPerOperation) cachedClients = classified;
    return classified;
  };
  const operationDeadlineMs = options.operationDeadlineMs ?? 120_000;
  const operationPollIntervalMs = options.operationPollIntervalMs ?? 1_000;
  const locate = (kind: ResourceKind, name: string): ResourceLocator =>
    resourceLocator({ provider, kind, nativeId: name, scope: { namespace, context: options.context } });

  // Observes accepted foreground deletions until every object is gone (GET returns 404). Finalizers and
  // dependents can keep an object terminating for a long time, so this is bounded; on expiry the
  // caller gets PendingOperationError with the last observed state, never a fabricated deleted. Each GET
  // carries the observation signal, so the deadline cancels a read that is still in flight.
  const observeAbsence = async (clients: KubernetesClients, name: string, kinds: ResourceKind[]): Promise<void> => {
    const readers: Record<ResourceKind, ((signal: AbortSignal) => Promise<KubernetesObject>) | undefined> = {
      deployment: clients.apps.readNamespacedDeployment
        ? (signal) => clients.apps.readNamespacedDeployment!({ namespace, name }, abortableRequest(signal))
        : undefined,
      service: clients.core.readNamespacedService ? (signal) => clients.core.readNamespacedService!({ namespace, name }, abortableRequest(signal)) : undefined
    };
    const resource = locate("service", name);
    const unobservable = kinds.filter((kind) => !readers[kind]);
    if (unobservable.length > 0) {
      throw new PendingOperationError(
        `Kubernetes service.delete was accepted for ${kinds.join(" and ")} ${name}, but the client cannot read ${unobservable.join(" and ")} to confirm deletion.`,
        { operation: "service.delete", resource, state: kinds.map((kind) => `${kind}=terminating`).join(",") }
      );
    }
    let remaining = [...kinds];
    await observeUntilTerminal<void>(
      async ({ signal }) => {
        const states: string[] = [];
        const stillPresent: ResourceKind[] = [];
        for (const kind of remaining) {
          try {
            const object = await readers[kind]!(signal);
            stillPresent.push(kind);
            states.push(`${kind}=${object.metadata?.deletionTimestamp ? "terminating" : "present"}`);
          } catch (error) {
            if (providerErrorStatus(error) !== 404) throw error;
          }
        }
        remaining = stillPresent;
        return remaining.length === 0 ? { done: true, value: undefined } : { done: false, state: states.join(",") };
      },
      { operation: "service.delete", resource, deadlineMs: operationDeadlineMs, intervalMs: operationPollIntervalMs }
    );
  };

  // Compensates a Deployment created by a deploy whose Service step failed. The original error stays
  // the primary error; the cleanup outcome and any residual resources are reported beside it instead
  // of being swallowed.
  const rollbackDeployment = async (apps: AppsApi, deploymentName: string, serviceName: string, error: unknown): Promise<Error> => {
    const deployment = locate("deployment", deploymentName);
    const status = providerErrorStatus(error);
    // A 4xx means the API server rejected the Service, so it was not created. Anything else leaves its
    // existence unknown.
    const serviceRejected = status !== undefined && status >= 400 && status < 500;
    const service = locate("service", serviceName);
    const attempt = await requestForegroundDelete("deployment", () =>
      requireAppsMethod(apps, "deleteNamespacedDeployment").call(apps, deleteRequest(namespace, deploymentName))
    );
    const cleanup: CleanupOutcome =
      attempt.state === "failed"
        ? { status: "failed", resources: [deployment], residual: [deployment], error: attempt.error }
        : attempt.state === "accepted"
          ? { status: "pending", resources: [deployment], residual: [deployment] }
          : { status: "succeeded", resources: [deployment] };
    const effects = {
      operation: "service.deploy",
      outcome: serviceRejected ? ("failed" as const) : ("unknown" as const),
      resources: serviceRejected ? [deployment] : [deployment, service],
      primaryError: error,
      cleanup
    };
    const message = `Kubernetes service.deploy failed after creating Deployment ${deploymentName}: ${errorMessage(error)}`;
    return cleanup.status === "failed" ? new CleanupFailureError(message, cleanup, error, effects) : new PartialEffectsError(message, effects);
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
          throw await rollbackDeployment(clients.apps, deploymentName, name, error);
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
        // Each resource is deleted independently. A Deployment that is already gone (for example after
        // an earlier attempt that failed on the Service) never stops the Service delete from running.
        const attempts = [
          await requestForegroundDelete("deployment", () => deleteNamespacedDeployment.call(clients.apps, deleteRequest(namespace, name))),
          await requestForegroundDelete("service", () => deleteNamespacedService.call(clients.core, deleteRequest(namespace, name)))
        ];
        const failed = attempts.filter((attempt) => attempt.state === "failed");
        const accepted = attempts.filter((attempt) => attempt.state === "accepted");
        if (failed.length > 0) {
          const primary = failed[0]!;
          if (accepted.length === 0) throw primary.error;
          throw new PartialEffectsError(
            `Kubernetes service.delete accepted the ${accepted.map((attempt) => attempt.kind).join(" and ")} delete but the ${failed
              .map((attempt) => attempt.kind)
              .join(" and ")} delete failed: ${errorMessage(primary.error)}`,
            {
              operation: "service.delete",
              outcome: "failed",
              resources: [...failed, ...accepted].map((attempt) => locate(attempt.kind, name)),
              primaryError: primary.error,
              cleanup: { status: "not-attempted" }
            }
          );
        }
        if (accepted.length > 0) {
          await observeAbsence(
            clients,
            name,
            accepted.map((attempt) => attempt.kind)
          );
        }
        const deployment = attempts[0]!.response;
        const service = attempts[1]!.response;
        const observed = Object.fromEntries(attempts.map((attempt) => [attempt.kind, attempt.state === "absent" ? "already-absent" : "deleted"]));
        const resolvedName = deployment?.metadata?.name ?? service?.metadata?.name ?? name;
        const policy = context.evaluatePolicy();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.delete",
              capabilityPath: "service.delete",
              startedAt,
              policy: {
                ...policy,
                notes: [...policy.notes, "Kubernetes service.delete reports deleted only after the Deployment and Service are observed absent."]
              },
              resource: { id: resolvedName, name: resolvedName, status: "deleted" },
              metadata: kubernetesReceiptMetadata("apps/v1+v1", {
                namespace,
                deploymentName: deployment?.metadata?.name ?? name,
                serviceName: service?.metadata?.name ?? name,
                observed,
                reason: spec.reason
              })
            })
          : undefined;
        return {
          id: resolvedName,
          provider,
          name: resolvedName,
          status: "deleted",
          metadata: { namespace, deployment, service, observed, reason: spec.reason },
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
        return {
          id: name,
          provider,
          name,
          logs: result.logs,
          truncation: result.truncation,
          nextCursor: result.nextCursor,
          metadata: result.metadata,
          receipt
        };
      }
    }
  };
}
