import {
  CreateServiceCommand,
  DeleteServiceCommand,
  DescribeServiceDeploymentsCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  UpdateServiceCommand,
  type Service,
  type ServiceDeployment as EcsServiceDeployment,
  type Task
} from "@aws-sdk/client-ecs";
import {
  asProviderError,
  capsuleOperationTag,
  capsuleOperationTags,
  logsFromOutput,
  observeUntilTerminal,
  resourceLocator,
  type AdapterContext,
  AdapterExecutionError,
  CleanupFailureError,
  PendingOperationError,
  type CapsuleAdapter,
  type CapabilityMap,
  type CancelJobResult,
  type CancelJobSpec,
  type DeletedService,
  type DeleteServiceSpec,
  type DeployServiceSpec,
  type JobStatusResult,
  type JobStatusSpec,
  type JobRun,
  type JobRunStatus,
  type ResourceLocator,
  type RunJobSpec,
  type ServiceDeployment,
  type ServiceStatus,
  type ServiceStatusResult,
  type ServiceStatusSpec
} from "@capsule-sdk/core";

interface ECSClientLike {
  send(
    command:
      | RunTaskCommand
      | CreateServiceCommand
      | DescribeTasksCommand
      | StopTaskCommand
      | DescribeServicesCommand
      | DescribeServiceDeploymentsCommand
      | UpdateServiceCommand
      | DeleteServiceCommand,
    options?: { abortSignal?: AbortSignal }
  ): Promise<any>;
}

/**
 * Client-side bound for observing an ECS service deletion. ECS accepts DeleteService while the service
 * is still DRAINING its tasks; service.delete resolves only once DescribeServices reports INACTIVE (or
 * the service is gone) and otherwise throws PendingOperationError when the deadline expires.
 */
export interface ECSDeleteObservationOptions {
  /** Total observation budget in milliseconds. Defaults to 600000 (10 minutes). */
  deadlineMs?: number;
  /** Delay between DescribeServices observations in milliseconds. Defaults to 5000. */
  intervalMs?: number;
}

export interface ECSAdapterOptions {
  region?: string;
  cluster: string;
  taskDefinition: string;
  containerName: string;
  subnets?: string[];
  securityGroups?: string[];
  assignPublicIp?: "ENABLED" | "DISABLED";
  launchType?: "FARGATE" | "EC2" | "EXTERNAL";
  /** Bounds for observing service.delete until ECS reports the service INACTIVE. */
  deleteObservation?: ECSDeleteObservationOptions;
  client?: ECSClientLike;
}

interface ECSServiceCleanupMetadata {
  action: "delete-created-service";
  service: string;
  /**
   * deleted: DeleteService reported INACTIVE. pending: ECS accepted the deletion but the service is
   * still draining (not observed further on this failure path). failed: the DeleteService request failed.
   */
  status: "deleted" | "pending" | "failed";
  cluster: string;
  /** Service status from the DeleteService response, for example DRAINING. */
  providerStatus?: string;
  error?: string;
}

type CleanupAwareError = Error & { cleanup?: ECSServiceCleanupMetadata };

const provider = "ecs";
const adapter = "ecs";
const defaultDeleteObservationDeadlineMs = 600_000;
const defaultDeleteObservationIntervalMs = 5_000;

export const ecsCapabilities: CapabilityMap = {
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
    timeout: "unsupported",
    env: "native",
    resources: "emulated"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "native",
    status: "native",
    logs: "unsupported",
    url: "unsupported",
    scale: "native",
    rollback: "unsupported",
    healthcheck: "unsupported",
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

function command(commandValue: string[] | string | undefined): string[] | undefined {
  return typeof commandValue === "string" ? ["sh", "-lc", commandValue] : commandValue;
}

function env(envVars?: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(envVars ?? {}).map(([name, value]) => ({ name, value }));
}

function networkConfiguration(options: ECSAdapterOptions) {
  if (!options.subnets?.length && !options.securityGroups?.length) return undefined;
  return {
    awsvpcConfiguration: {
      subnets: options.subnets,
      securityGroups: options.securityGroups,
      assignPublicIp: options.assignPublicIp ?? "DISABLED"
    }
  };
}

function tags(labels?: Record<string, string>, idempotencyKey?: string, capabilityPath?: string): Array<{ key: string; value: string }> | undefined {
  const entries = Object.entries({ ...(labels ?? {}), ...(capabilityPath ? (capsuleOperationTags({ idempotencyKey, capabilityPath }) ?? {}) : {}) });
  return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : undefined;
}

/**
 * Native RunTask clientToken for a caller idempotency key (GAP-17): a 32-hex hash of the key scoped to
 * this adapter, region and cluster, so the raw key never reaches AWS. ECS uses the token to make a
 * retried RunTask idempotent; a ConflictException lists the task ARNs already associated with the
 * token. This is provider retry deduplication within the ECS token window, not exactly-once execution.
 */
function ecsRunTaskClientToken(idempotencyKey: string | undefined, options: Pick<ECSAdapterOptions, "region" | "cluster">): string | undefined {
  return capsuleOperationTag({
    idempotencyKey,
    capabilityPath: "job.run",
    idempotencyScope: `ecs:job.run:${options.region ?? "sdk-default-region"}:${options.cluster}`
  });
}

/**
 * Completion rule for a STOPPED task (GAP-13): the job is the configured `containerName`, the container
 * Capsule overrides with the requested command. Its exit code alone decides success. Other containers
 * (sidecars, helpers) do not change the outcome; their raw status, exit codes and reasons stay in
 * metadata. A main container that is missing or has no exit code did not complete, so the job failed.
 */
function statusFromTask(task: Task | undefined, mainContainer: string): JobRunStatus {
  switch (task?.lastStatus) {
    case "PROVISIONING":
    case "PENDING":
      return "queued";
    case "ACTIVATING":
    case "RUNNING":
    case "DEACTIVATING":
    case "STOPPING":
    case "DEPROVISIONING":
      return "running";
    case "STOPPED":
      if (task.stopCode === "UserInitiated" || task.stoppedReason?.toLowerCase().includes("stopped by user")) return "cancelled";
      return task.containers?.find((container) => container.name === mainContainer)?.exitCode === 0 ? "succeeded" : "failed";
    default:
      return task ? "running" : "failed";
  }
}

function taskMetadata(task: Task | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskArn: task?.taskArn,
    lastStatus: task?.lastStatus,
    desiredStatus: task?.desiredStatus,
    healthStatus: task?.healthStatus,
    stopCode: task?.stopCode,
    stoppedReason: task?.stoppedReason,
    startedAt: task?.startedAt?.toISOString(),
    stoppedAt: task?.stoppedAt?.toISOString(),
    containers: task?.containers?.map((container) => ({
      name: container.name,
      lastStatus: container.lastStatus,
      exitCode: container.exitCode,
      reason: container.reason
    })),
    ...extra
  };
}

/**
 * An older deployment with rolloutState FAILED next to a PRIMARY deployment that did not fail is
 * ambiguous in DescribeServices alone (GAP-14): a circuit-breaker rollback and a user's superseding
 * redeploy both look like that. The service deployment that `currentServiceDeployment` names separates
 * them: a rollback moves that same service deployment to ROLLBACK_*, a new deployment started by the
 * user is a new service deployment that is PENDING, IN_PROGRESS or SUCCESSFUL.
 */
function hasSupersededFailedDeployment(service: Service | undefined): boolean {
  const deployments = service?.deployments ?? [];
  const primary = deployments.find((deployment) => deployment.status === "PRIMARY");
  if (!primary || primary.rolloutState === "FAILED") return false;
  return deployments.some((deployment) => deployment !== primary && deployment.rolloutState === "FAILED");
}

/** How the ambiguous FAILED deployment was resolved, kept in status metadata. */
interface ServiceDeploymentResolution {
  source: "describe-service-deployments" | "unavailable";
  /** ARN from DescribeServices currentServiceDeployment, when ECS returned one. */
  serviceDeploymentArn?: string;
  status?: string;
  statusReason?: string;
  rollback?: { reason?: string; startedAt?: string; serviceRevisionArn?: string };
  /** Why the current service deployment could not be read; the status then stays failed. */
  reason?: string;
}

// Service deployment states in which the user's most recent deployment has not failed. Every other state
// (ROLLBACK_*, STOP_REQUESTED, STOPPED, or a value this adapter does not know) keeps the conservative failed.
const currentDeploymentNotFailed = new Set(["PENDING", "IN_PROGRESS", "SUCCESSFUL"]);

async function resolveCurrentServiceDeployment(client: ECSClientLike, service: Service): Promise<ServiceDeploymentResolution> {
  const serviceDeploymentArn = service.currentServiceDeployment;
  if (!serviceDeploymentArn) {
    return { source: "unavailable", reason: "DescribeServices returned no currentServiceDeployment." };
  }
  let current: EcsServiceDeployment | undefined;
  try {
    const response: { serviceDeployments?: EcsServiceDeployment[] } = await client.send(
      new DescribeServiceDeploymentsCommand({ serviceDeploymentArns: [serviceDeploymentArn] })
    );
    current = response.serviceDeployments?.find((deployment) => deployment.serviceDeploymentArn === serviceDeploymentArn);
  } catch (error) {
    // For example AccessDeniedException without ecs:DescribeServiceDeployments. The status stays failed,
    // which is what DescribeServices alone supports.
    return { source: "unavailable", serviceDeploymentArn, reason: `DescribeServiceDeployments failed: ${errorName(error)}` };
  }
  if (!current) {
    return { source: "unavailable", serviceDeploymentArn, reason: "DescribeServiceDeployments did not return the current service deployment." };
  }
  if (current.serviceArn !== undefined && service.serviceArn !== undefined && current.serviceArn !== service.serviceArn) {
    return { source: "unavailable", serviceDeploymentArn, reason: "The current service deployment belongs to a different service." };
  }
  return {
    source: "describe-service-deployments",
    serviceDeploymentArn,
    status: current.status,
    statusReason: current.statusReason,
    ...(current.rollback
      ? {
          rollback: {
            reason: current.rollback.reason,
            startedAt: current.rollback.startedAt?.toISOString(),
            serviceRevisionArn: current.rollback.serviceRevisionArn
          }
        }
      : {})
  };
}

// Name of the provider error under Capsule's AdapterExecutionError wrapper, for example AccessDeniedException.
function errorName(error: unknown): string {
  let name = error instanceof Error ? error.name : typeof error;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = (current as { name?: unknown }).name;
    if (typeof candidate === "string" && candidate !== "") name = candidate;
    current = (current as { cause?: unknown }).cause;
  }
  return name;
}

function serviceStatus(service?: Service, resolution?: ServiceDeploymentResolution): ServiceStatus {
  if (!service) return "failed";
  if (service.status === "INACTIVE") return "deleted";
  if (service.deployments?.some((deployment) => deployment.rolloutState === "FAILED")) {
    // Only an older FAILED deployment that the current service deployment superseded is ignored.
    const superseded =
      hasSupersededFailedDeployment(service) &&
      resolution?.source === "describe-service-deployments" &&
      currentDeploymentNotFailed.has(resolution.status ?? "");
    if (!superseded) return "failed";
  }
  if (service.status === "DRAINING") return "deploying";

  const desired = service.desiredCount ?? 0;
  const running = service.runningCount ?? 0;
  const pending = service.pendingCount ?? 0;
  const primary = service.deployments?.find((deployment) => deployment.status === "PRIMARY");
  if (pending === 0 && running >= desired && (!primary || primary.rolloutState === "COMPLETED")) return "ready";
  return "deploying";
}

function serviceMetadata(service: Service | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serviceArn: service?.serviceArn,
    serviceName: service?.serviceName,
    status: service?.status,
    currentServiceDeployment: service?.currentServiceDeployment,
    desiredCount: service?.desiredCount,
    runningCount: service?.runningCount,
    pendingCount: service?.pendingCount,
    deployments: service?.deployments?.map((deployment) => ({
      id: deployment.id,
      status: deployment.status,
      rolloutState: deployment.rolloutState,
      rolloutStateReason: deployment.rolloutStateReason,
      desiredCount: deployment.desiredCount,
      runningCount: deployment.runningCount,
      pendingCount: deployment.pendingCount,
      taskDefinition: deployment.taskDefinition
    })),
    events: service?.events?.map((event) => ({
      id: event.id,
      message: event.message,
      createdAt: event.createdAt?.toISOString()
    })),
    ...extra
  };
}

function defaultClient(options: ECSAdapterOptions): ECSClientLike {
  return new ECSClient({ region: options.region });
}

function classifiedClient(client: ECSClientLike): ECSClientLike {
  return {
    send: async (command) => {
      try {
        return await client.send(command);
      } catch (error) {
        throw asProviderError(error, "ECS API request failed.");
      }
    }
  };
}

async function cleanupCreatedServiceAfterDeployFailure(
  client: ECSClientLike,
  cluster: string,
  service: Service,
  serviceName: string,
  deployError: unknown
): Promise<never> {
  const serviceId = service.serviceArn ?? service.serviceName ?? serviceName;
  const cleanup: ECSServiceCleanupMetadata = {
    action: "delete-created-service",
    service: serviceId,
    status: "pending",
    cluster
  };
  try {
    const deleted = await client.send(new DeleteServiceCommand({ cluster, service: serviceId, force: true }));
    const providerStatus: string | undefined = deleted?.service?.status;
    if (providerStatus !== undefined) cleanup.providerStatus = providerStatus;
    // An accepted DeleteService is not a completed deletion: DRAINING tasks may still run.
    cleanup.status = providerStatus === "INACTIVE" ? "deleted" : "pending";
  } catch (cleanupError) {
    cleanup.status = "failed";
    cleanup.error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
  if (cleanup.status === "failed") {
    throw new CleanupFailureError("ECS service cleanup failed after service creation.", cleanup, { operationError: deployError });
  }
  if (deployError instanceof Error) {
    (deployError as CleanupAwareError).cleanup = cleanup;
    throw deployError;
  }
  throw new AdapterExecutionError("ECS service deploy failed after service creation.", { deployError, cleanup });
}

function hasErrorName(error: unknown, name: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ((current as { name?: unknown }).name === name) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

interface ObservedServiceDeletion {
  /** INACTIVE from DescribeServices, MISSING from its failures, or not-found from ServiceNotFoundException. */
  terminal: "INACTIVE" | "MISSING" | "not-found";
  service?: Service;
  observations: number;
}

/**
 * Observes DescribeServices until the service is INACTIVE or no longer known to ECS (CD-DELETE). Throws
 * PendingOperationError with the last native status when the deadline expires.
 */
/** Both observation phases share one budget; report that configured budget rather than a phase remainder. */
async function withDeleteBudget<T>(deadlineMs: number, observe: () => Promise<T>): Promise<T> {
  try {
    return await observe();
  } catch (error) {
    if (!(error instanceof PendingOperationError) || error.deadlineMs === deadlineMs) throw error;
    throw new PendingOperationError(
      `service.delete for service ${error.resource.nativeId} is still pending after the ${deadlineMs}ms observation budget.`,
      {
        operation: error.operation,
        resource: error.resource,
        ...(error.state === undefined ? {} : { state: error.state }),
        deadlineMs,
        ...(error.observations === undefined ? {} : { observations: error.observations })
      },
      error.cause
    );
  }
}

function activeTaskCount(service: Service | undefined): number {
  return (service?.runningCount ?? 0) + (service?.pendingCount ?? 0);
}

/**
 * Observes DescribeServices after the scale-to-zero request until no task is running or pending (GAP-11).
 * ECS only deletes a service without force once it has no running tasks, so a non-forced DeleteService
 * must not race the scale-down. Throws PendingOperationError, before any DeleteService, at the deadline.
 */
async function observeScaleDownDrained(
  client: ECSClientLike,
  options: ECSAdapterOptions,
  serviceId: string,
  locator: ResourceLocator,
  deadlineMs: number
): Promise<void> {
  await observeUntilTerminal<void>(
    async ({ signal }) => {
      const response: { services?: Service[] } = await client.send(new DescribeServicesCommand({ cluster: options.cluster, services: [serviceId] }), {
        abortSignal: signal
      });
      const service = response.services?.[0];
      if (service && activeTaskCount(service) === 0) return { done: true, value: undefined };
      return {
        done: false,
        state: service ? `${service.status ?? "unknown"} runningCount=${service.runningCount ?? 0} pendingCount=${service.pendingCount ?? 0}` : "unknown"
      };
    },
    { operation: "service.delete", resource: locator, deadlineMs, intervalMs: options.deleteObservation?.intervalMs ?? defaultDeleteObservationIntervalMs }
  );
}

async function observeServiceDeletion(
  client: ECSClientLike,
  options: ECSAdapterOptions,
  serviceId: string,
  locator: ResourceLocator,
  deadlineMs: number
): Promise<ObservedServiceDeletion> {
  return observeUntilTerminal<ObservedServiceDeletion>(
    async ({ attempt, signal }) => {
      let response: { services?: Service[]; failures?: Array<{ arn?: string; reason?: string }> };
      try {
        response = await client.send(new DescribeServicesCommand({ cluster: options.cluster, services: [serviceId] }), { abortSignal: signal });
      } catch (error) {
        // ECS may purge INACTIVE services; DescribeServices then reports ServiceNotFoundException.
        if (hasErrorName(error, "ServiceNotFoundException")) return { done: true, value: { terminal: "not-found", observations: attempt } };
        throw error;
      }
      const service = response.services?.[0];
      if (service?.status === "INACTIVE") return { done: true, value: { terminal: "INACTIVE", service, observations: attempt } };
      if (!service && response.failures?.some((failure) => failure.reason === "MISSING")) {
        return { done: true, value: { terminal: "MISSING", observations: attempt } };
      }
      return { done: false, state: service?.status ?? "unknown" };
    },
    {
      operation: "service.delete",
      resource: locator,
      deadlineMs,
      intervalMs: options.deleteObservation?.intervalMs ?? defaultDeleteObservationIntervalMs
    }
  );
}

export function ecs(options: ECSAdapterOptions): CapsuleAdapter {
  // One classified client per adapter, created on first use (AWS-05). An injected client stays
  // caller-owned; the default SDK client is built lazily so constructing the adapter resolves no
  // credentials, and reusing it keeps the SDK keep-alive connection pool and credential cache warm.
  let cachedClient: ECSClientLike | undefined;
  const getClient = (): ECSClientLike => (cachedClient ??= classifiedClient(options.client ?? defaultClient(options)));
  return {
    name: adapter,
    provider,
    capabilities: ecsCapabilities,
    raw: { region: options.region, cluster: options.cluster, taskDefinition: options.taskDefinition },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const response = await getClient().send(
          new RunTaskCommand({
            cluster: options.cluster,
            taskDefinition: options.taskDefinition,
            launchType: options.launchType ?? "FARGATE",
            networkConfiguration: networkConfiguration(options),
            tags: tags(spec.labels, spec.idempotencyKey, "job.run"),
            clientToken: ecsRunTaskClientToken(spec.idempotencyKey, options),
            overrides: {
              containerOverrides: [
                {
                  name: options.containerName,
                  command: command(spec.command),
                  environment: env(spec.env),
                  cpu: spec.resources?.cpu,
                  memory: spec.resources?.memoryMb
                }
              ]
            }
          })
        );
        const task = response.tasks?.[0];
        const failure = response.failures?.[0];
        const status: JobRunStatus = task ? "running" : "failed";
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command: command(spec.command),
              exitCode: status === "failed" ? 1 : undefined,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "ECS RunTask is native for an existing task definition.",
                  "Capsule does not register task definitions from image yet; image is recorded for intent/evidence only.",
                  "Network configuration, IAM roles, logging, and task isolation are ECS/Fargate responsibilities.",
                  ...(spec.idempotencyKey
                    ? [
                        "idempotencyKey is sent as a hashed RunTask clientToken scoped to the adapter region and cluster; ECS deduplicates retries within its token window. It is not an exactly-once guarantee."
                      ]
                    : [])
                ]
              },
              resource: { id: task?.taskArn ?? failure?.arn ?? options.taskDefinition, name: options.taskDefinition, status },
              metadata: taskMetadata(task, { cluster: options.cluster, failures: response.failures })
            })
          : undefined;
        return {
          id: task?.taskArn ?? options.taskDefinition,
          provider,
          status,
          result:
            status === "failed"
              ? { exitCode: 1, stdout: "", stderr: JSON.stringify(response.failures ?? []), logs: logsFromOutput("", ""), artifacts: [], receipt }
              : undefined,
          receipt
        };
      },
      status: async (spec: JobStatusSpec, context: AdapterContext): Promise<JobStatusResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new DescribeTasksCommand({ cluster: options.cluster, tasks: [spec.id] }));
        const task = response.tasks?.[0];
        const failure = response.failures?.[0];
        const status = statusFromTask(task, options.containerName);
        const id = task?.taskArn ?? failure?.arn ?? spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.status",
              capabilityPath: "job.status",
              startedAt,
              resource: { id, name: id, status },
              metadata: taskMetadata(task, { cluster: options.cluster, completionContainer: options.containerName, failures: response.failures })
            })
          : undefined;
        return {
          id,
          provider,
          status,
          receipt,
          metadata: taskMetadata(task, { cluster: options.cluster, completionContainer: options.containerName, failures: response.failures })
        };
      },
      cancel: async (spec: CancelJobSpec, context: AdapterContext): Promise<CancelJobResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new StopTaskCommand({ cluster: options.cluster, task: spec.id, reason: spec.reason }));
        const task = response.task;
        const status = statusFromTask(task, options.containerName) === "cancelled" ? "cancelled" : "cancelling";
        const id = task?.taskArn ?? spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.cancel",
              capabilityPath: "job.cancel",
              startedAt,
              resource: { id, name: id, status },
              metadata: taskMetadata(task, { cluster: options.cluster, reason: spec.reason })
            })
          : undefined;
        return {
          id,
          provider,
          status,
          receipt,
          metadata: taskMetadata(task, { cluster: options.cluster, reason: spec.reason })
        };
      }
    },
    service: {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext): Promise<ServiceDeployment> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const client = getClient();
        const response = await client.send(
          new CreateServiceCommand({
            cluster: options.cluster,
            serviceName: spec.name,
            taskDefinition: options.taskDefinition,
            launchType: options.launchType ?? "FARGATE",
            desiredCount: spec.scale?.min ?? 1,
            networkConfiguration: networkConfiguration(options),
            tags: tags(spec.labels, spec.idempotencyKey, "service.deploy")
          })
        );
        const service = response.service;
        try {
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
                    "ECS CreateService is native for an existing task definition.",
                    "Capsule does not create load balancers, target groups, service discovery, or task definitions in this adapter.",
                    ...(spec.idempotencyKey
                      ? [
                          "service.deploy idempotencyKey is a correlation tag only; ECS service names are unique per cluster, and no native clientToken is sent."
                        ]
                      : [])
                  ]
                },
                resource: { id: service?.serviceArn ?? spec.name, name: spec.name, status: "deploying" },
                metadata: serviceMetadata(service, { cluster: options.cluster, taskDefinition: options.taskDefinition })
              })
            : undefined;
          return { id: service?.serviceArn ?? spec.name, provider, name: spec.name, status: "deploying", receipt };
        } catch (error) {
          if (service) {
            await cleanupCreatedServiceAfterDeployFailure(client, options.cluster, service, spec.name, error);
          }
          throw error;
        }
      },
      status: async (spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult> => {
        const startedAt = new Date();
        const client = getClient();
        const response = await client.send(new DescribeServicesCommand({ cluster: options.cluster, services: [spec.id] }));
        const service: Service | undefined = response.services?.[0];
        const failure = response.failures?.[0];
        // A second read happens only for the ambiguous rollout shape (GAP-14).
        const deploymentResolution = service && hasSupersededFailedDeployment(service) ? await resolveCurrentServiceDeployment(client, service) : undefined;
        const status = serviceStatus(service, deploymentResolution);
        const id = service?.serviceArn ?? failure?.arn ?? spec.id;
        const name = service?.serviceName ?? spec.id;
        const statusMetadata = serviceMetadata(service, {
          cluster: options.cluster,
          failures: response.failures,
          ...(deploymentResolution ? { serviceDeployment: deploymentResolution } : {})
        });
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.status",
              capabilityPath: "service.status",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: [
                  "ECS service status is read from DescribeServices rollout and count fields.",
                  ...(deploymentResolution
                    ? [
                        "An older FAILED deployment next to a PRIMARY deployment that did not fail is resolved with DescribeServiceDeployments on currentServiceDeployment: a rollback reports failed, a newer deployment reports its own progress."
                      ]
                    : [])
                ]
              },
              resource: { id, name, status },
              metadata: statusMetadata
            })
          : undefined;
        return {
          id,
          provider,
          name,
          status,
          receipt,
          metadata: statusMetadata
        };
      },
      delete: async (spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService> => {
        const startedAt = new Date();
        const client = getClient();
        const scale = await client.send(new UpdateServiceCommand({ cluster: options.cluster, service: spec.id, desiredCount: 0 }));
        const observationDeadlineMs = options.deleteObservation?.deadlineMs ?? defaultDeleteObservationDeadlineMs;
        const observationStartedAt = Date.now();
        const remainingObservationMs = () => Math.max(1, observationDeadlineMs - (Date.now() - observationStartedAt));
        const locatorFor = (nativeId: string) =>
          resourceLocator({ provider, kind: "service", nativeId, scope: { cluster: options.cluster, region: options.region } });
        if (!spec.force && activeTaskCount(scale.service) > 0) {
          // Without force, wait for the scale-down to finish instead of racing DeleteService against
          // running tasks. force=true keeps the documented ECS behavior of deleting with tasks running.
          const serviceId = scale.service?.serviceArn ?? spec.id;
          await withDeleteBudget(observationDeadlineMs, () =>
            observeScaleDownDrained(client, options, serviceId, locatorFor(serviceId), remainingObservationMs())
          );
        }
        const response = await client.send(new DeleteServiceCommand({ cluster: options.cluster, service: spec.id, force: spec.force }));
        const acknowledged: Service | undefined = response.service;
        const acknowledgedId = acknowledged?.serviceArn ?? scale.service?.serviceArn ?? spec.id;
        // DeleteService only starts deletion; DRAINING is not deleted (AWS-04). Resolve once ECS reports the
        // service INACTIVE or gone, otherwise throw PendingOperationError from the bounded observation.
        const observed: ObservedServiceDeletion =
          acknowledged?.status === "INACTIVE"
            ? { terminal: "INACTIVE", service: acknowledged, observations: 0 }
            : await withDeleteBudget(observationDeadlineMs, () =>
                observeServiceDeletion(client, options, acknowledgedId, locatorFor(acknowledgedId), remainingObservationMs())
              );
        const service = observed.service ?? acknowledged ?? scale.service;
        const id = service?.serviceArn ?? spec.id;
        const name = service?.serviceName ?? spec.id;
        const deletion = {
          acknowledgedStatus: acknowledged?.status,
          observedTerminal: observed.terminal,
          observations: observed.observations
        };
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.delete",
              capabilityPath: "service.delete",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: [
                  "ECS service deletion first scales desiredCount to zero, then calls DeleteService.",
                  "Without force, DeleteService is sent only after DescribeServices shows no running or pending tasks.",
                  "The service is reported deleted only after DescribeServices shows it INACTIVE or no longer present."
                ]
              },
              resource: { id, name, status: "deleted" },
              metadata: serviceMetadata(service, {
                cluster: options.cluster,
                reason: spec.reason,
                semantics: "scale-to-zero-then-delete-service",
                scaleServiceArn: scale.service?.serviceArn,
                force: spec.force,
                deletion
              })
            })
          : undefined;
        return {
          id,
          provider,
          name,
          status: "deleted",
          receipt,
          metadata: serviceMetadata(service, {
            cluster: options.cluster,
            reason: spec.reason,
            semantics: "scale-to-zero-then-delete-service",
            scaleServiceArn: scale.service?.serviceArn,
            force: spec.force,
            deletion
          })
        };
      }
    }
  };
}
