import { CreateServiceCommand, ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import {
  logsFromOutput,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type DeployServiceSpec,
  type JobRun,
  type RunJobSpec,
  type ServiceDeployment
} from "@capsule/core";

interface ECSClientLike {
  send(command: RunTaskCommand | CreateServiceCommand): Promise<any>;
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
    status: "experimental",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "native",
    resources: "emulated"
  },
  service: {
    deploy: "native",
    update: "unsupported",
    delete: "unsupported",
    status: "experimental",
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
        const status = task ? "running" : "failed";
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
              metadata: { cluster: options.cluster, failures: response.failures }
            })
          : undefined;
        return {
          id: task?.taskArn ?? options.taskDefinition,
          provider,
          status,
          result: status === "failed" ? { exitCode: 1, stdout: "", stderr: JSON.stringify(response.failures ?? []), logs: logsFromOutput("", ""), artifacts: [], receipt } : undefined,
          receipt
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
              metadata: { cluster: options.cluster, taskDefinition: options.taskDefinition }
            })
          : undefined;
        return { id: service?.serviceArn ?? spec.name, provider, name: spec.name, status: "deploying", receipt };
      }
    }
  };
}
