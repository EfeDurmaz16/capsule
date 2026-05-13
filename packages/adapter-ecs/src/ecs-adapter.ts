import {
  CreateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  UpdateServiceCommand,
  type Service,
  type Task
} from "@aws-sdk/client-ecs";
import {
  logsFromOutput,
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
  type JobRun,
  type JobRunStatus,
  type RunJobSpec,
  type ServiceDeployment,
  type ServiceStatus,
  type ServiceStatusResult,
  type ServiceStatusSpec
} from "@capsule/core";

interface ECSClientLike {
  send(
    command:
      | RunTaskCommand
      | CreateServiceCommand
      | DescribeTasksCommand
      | StopTaskCommand
      | DescribeServicesCommand
      | UpdateServiceCommand
      | DeleteServiceCommand
  ): Promise<any>;
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
  client?: ECSClientLike;
}

const provider = "ecs";
const adapter = "ecs";

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

function tags(labels?: Record<string, string>): Array<{ key: string; value: string }> | undefined {
  const entries = Object.entries(labels ?? {});
  return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : undefined;
}

function statusFromTask(task?: Task): JobRunStatus {
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
      if (task.containers?.some((container) => container.exitCode !== undefined && container.exitCode !== 0)) return "failed";
      if (task.containers?.some((container) => container.exitCode === 0)) return "succeeded";
      return "failed";
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
    ...extra
  };
}

function serviceStatus(service?: Service): ServiceStatus {
  if (!service) return "failed";
  if (service.status === "INACTIVE") return "deleted";
  if (service.deployments?.some((deployment) => deployment.rolloutState === "FAILED")) return "failed";
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

export function ecs(options: ECSAdapterOptions): CapsuleAdapter {
  const getClient = () => options.client ?? defaultClient(options);
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
            tags: tags(spec.labels),
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
                  "Network configuration, IAM roles, logging, and task isolation are ECS/Fargate responsibilities."
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
          result: status === "failed" ? { exitCode: 1, stdout: "", stderr: JSON.stringify(response.failures ?? []), logs: logsFromOutput("", ""), artifacts: [], receipt } : undefined,
          receipt
        };
      },
      status: async (spec: JobStatusSpec, context: AdapterContext): Promise<JobStatusResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new DescribeTasksCommand({ cluster: options.cluster, tasks: [spec.id] }));
        const task = response.tasks?.[0];
        const failure = response.failures?.[0];
        const status = statusFromTask(task);
        const id = task?.taskArn ?? failure?.arn ?? spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.status",
              capabilityPath: "job.status",
              startedAt,
              resource: { id, name: id, status },
              metadata: taskMetadata(task, { cluster: options.cluster, failures: response.failures })
            })
          : undefined;
        return {
          id,
          provider,
          status,
          receipt,
          metadata: taskMetadata(task, { cluster: options.cluster, failures: response.failures })
        };
      },
      cancel: async (spec: CancelJobSpec, context: AdapterContext): Promise<CancelJobResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new StopTaskCommand({ cluster: options.cluster, task: spec.id, reason: spec.reason }));
        const task = response.task;
        const status = statusFromTask(task) === "cancelled" ? "cancelled" : "cancelling";
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
        const response = await getClient().send(
          new CreateServiceCommand({
            cluster: options.cluster,
            serviceName: spec.name,
            taskDefinition: options.taskDefinition,
            launchType: options.launchType ?? "FARGATE",
            desiredCount: spec.scale?.min ?? 1,
            networkConfiguration: networkConfiguration(options),
            tags: tags(spec.labels)
          })
        );
        const service = response.service;
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
                  "Capsule does not create load balancers, target groups, service discovery, or task definitions in this adapter."
                ]
              },
              resource: { id: service?.serviceArn ?? spec.name, name: spec.name, status: "deploying" },
              metadata: serviceMetadata(service, { cluster: options.cluster, taskDefinition: options.taskDefinition })
            })
          : undefined;
        return { id: service?.serviceArn ?? spec.name, provider, name: spec.name, status: "deploying", receipt };
      },
      status: async (spec: ServiceStatusSpec, context: AdapterContext): Promise<ServiceStatusResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new DescribeServicesCommand({ cluster: options.cluster, services: [spec.id] }));
        const service = response.services?.[0];
        const failure = response.failures?.[0];
        const status = serviceStatus(service);
        const id = service?.serviceArn ?? failure?.arn ?? spec.id;
        const name = service?.serviceName ?? spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.status",
              capabilityPath: "service.status",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["ECS service status is read from DescribeServices rollout and count fields."]
              },
              resource: { id, name, status },
              metadata: serviceMetadata(service, { cluster: options.cluster, failures: response.failures })
            })
          : undefined;
        return {
          id,
          provider,
          name,
          status,
          receipt,
          metadata: serviceMetadata(service, { cluster: options.cluster, failures: response.failures })
        };
      },
      delete: async (spec: DeleteServiceSpec, context: AdapterContext): Promise<DeletedService> => {
        const startedAt = new Date();
        const client = getClient();
        const scale = await client.send(new UpdateServiceCommand({ cluster: options.cluster, service: spec.id, desiredCount: 0 }));
        const response = await client.send(new DeleteServiceCommand({ cluster: options.cluster, service: spec.id, force: spec.force }));
        const service = response.service ?? scale.service;
        const id = service?.serviceArn ?? spec.id;
        const name = service?.serviceName ?? spec.id;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.delete",
              capabilityPath: "service.delete",
              startedAt,
              policy: {
                decision: "allowed",
                applied: context.policy,
                notes: ["ECS service deletion first scales desiredCount to zero, then calls DeleteService."]
              },
              resource: { id, name, status: "deleted" },
              metadata: serviceMetadata(service, {
                cluster: options.cluster,
                reason: spec.reason,
                semantics: "scale-to-zero-then-delete-service",
                scaleServiceArn: scale.service?.serviceArn,
                force: spec.force
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
            force: spec.force
          })
        };
      }
    }
  };
}
