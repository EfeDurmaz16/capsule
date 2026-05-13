import * as k8s from "@kubernetes/client-node";
import {
  AdapterExecutionError,
  logsFromOutput,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CancelJobResult,
  type CancelJobSpec,
  type DeployServiceSpec,
  type JobRun,
  type JobRunStatus,
  type JobStatusResult,
  type JobStatusSpec,
  type RunJobSpec,
  type ServiceDeployment
} from "@capsule/core";

interface KubernetesObject {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    labels?: Record<string, string>;
    deletionTimestamp?: string;
  };
  status?: Record<string, unknown>;
}

interface BatchApi {
  createNamespacedJob(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
  readNamespacedJob?(input: { namespace: string; name: string }): Promise<KubernetesObject>;
  deleteNamespacedJob?(input: { namespace: string; name: string; gracePeriodSeconds?: number; propagationPolicy?: string; body?: unknown }): Promise<KubernetesObject>;
}

interface AppsApi {
  createNamespacedDeployment(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
}

interface CoreApi {
  createNamespacedService(input: { namespace: string; body: unknown }): Promise<KubernetesObject>;
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
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "native",
    env: "native",
    resources: "native"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "unsupported",
    status: "unsupported",
    logs: "unsupported",
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

function requireBatchMethod<K extends keyof BatchApi>(batch: BatchApi, method: K): NonNullable<BatchApi[K]> {
  const value = batch[method];
  if (typeof value !== "function") {
    throw new AdapterExecutionError(`Kubernetes Batch API client does not implement ${String(method)}.`);
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
        const url = clusterUrl(name, namespace, spec.ports?.[0]?.port);
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
      }
    }
  };
}
