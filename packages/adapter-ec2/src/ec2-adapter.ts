import { DescribeInstancesCommand, EC2Client, RunInstancesCommand, StartInstancesCommand, StopInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateMachineSpec,
  type DestroyMachineSpec,
  type Machine,
  type MachineLifecycleResult,
  type MachineStatusResult,
  type MachineStatusSpec,
  type StartMachineSpec,
  type StopMachineSpec
} from "@capsule/core";

interface EC2ClientLike {
  send(command: RunInstancesCommand | DescribeInstancesCommand | StartInstancesCommand | StopInstancesCommand | TerminateInstancesCommand): Promise<any>;
}

export interface EC2AdapterOptions {
  region?: string;
  imageId?: string;
  instanceType?: string;
  subnetId?: string;
  securityGroupIds?: string[];
  keyName?: string;
  iamInstanceProfileArn?: string;
  userData?: string;
  client?: EC2ClientLike;
}

const provider = "ec2";
const adapter = "ec2";

export const ec2Capabilities: CapabilityMap = {
  sandbox: {
    create: "unsupported",
    exec: "unsupported",
    fileRead: "unsupported",
    fileWrite: "unsupported",
    fileList: "unsupported",
    destroy: "unsupported"
  },
  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported",
    resources: "unsupported"
  },
  service: {
    deploy: "unsupported",
    update: "unsupported",
    delete: "unsupported",
    status: "unsupported",
    logs: "unsupported",
    url: "unsupported"
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
    create: "native",
    status: "native",
    exec: "unsupported",
    start: "native",
    stop: "native",
    destroy: "native",
    snapshot: "unsupported",
    volume: "unsupported",
    network: "experimental"
  }
};

function defaultClient(options: EC2AdapterOptions): EC2ClientLike {
  return new EC2Client({ region: options.region });
}

function tags(name: string, labels?: Record<string, string>) {
  return [
    {
      ResourceType: "instance",
      Tags: [
        { Key: "Name", Value: name },
        { Key: "ManagedBy", Value: "capsule" },
        ...Object.entries(labels ?? {}).map(([Key, Value]) => ({ Key, Value }))
      ]
    }
  ];
}

function userData(options: EC2AdapterOptions, spec: CreateMachineSpec): string | undefined {
  const payload = options.userData
    ? options.userData
    : spec.env
      ? `#!/bin/sh\n${Object.entries(spec.env)
          .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
          .join("\n")}\n`
      : undefined;
  return payload ? Buffer.from(payload).toString("base64") : undefined;
}

function capsuleMachineState(state: string | undefined): Machine["status"] {
  if (state === "running") return "running";
  if (state === "stopped" || state === "stopping") return "stopped";
  if (state === "terminated" || state === "shutting-down") return "deleted";
  if (state === "pending") return "creating";
  return "failed";
}

function lifecycleReceipt(
  context: AdapterContext,
  input: {
    type: "machine.status" | "machine.start" | "machine.stop" | "machine.destroy";
    capabilityPath: "machine.status" | "machine.start" | "machine.stop" | "machine.destroy";
    startedAt: Date;
    id: string;
    state: string;
    metadata?: Record<string, unknown>;
  }
) {
  return context.receipts
    ? context.createReceipt({
        type: input.type,
        capabilityPath: input.capabilityPath,
        startedAt: input.startedAt,
        policy: {
          decision: "allowed",
          applied: context.policy,
          notes: [
            "EC2 machine lifecycle operation is native.",
            "AWS state transitions are asynchronous; returned state is what EC2 reported for this API response."
          ]
        },
        resource: { id: input.id, status: input.state },
        metadata: input.metadata
      })
    : undefined;
}

export function ec2(options: EC2AdapterOptions = {}): CapsuleAdapter {
  const getClient = () => options.client ?? defaultClient(options);
  return {
    name: adapter,
    provider,
    capabilities: ec2Capabilities,
    raw: { region: options.region, subnetId: options.subnetId, securityGroupIds: options.securityGroupIds },
    machine: {
      create: async (spec: CreateMachineSpec, context: AdapterContext): Promise<Machine> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const imageId = spec.image ?? options.imageId;
        const instanceType = spec.size ?? options.instanceType;
        if (!imageId) {
          throw new AdapterExecutionError("EC2 machine.create requires spec.image or adapter imageId.");
        }
        if (!instanceType) {
          throw new AdapterExecutionError("EC2 machine.create requires spec.size or adapter instanceType.");
        }
        const response = await getClient().send(
          new RunInstancesCommand({
            ImageId: imageId,
            InstanceType: instanceType as any,
            MinCount: 1,
            MaxCount: 1,
            SubnetId: options.subnetId,
            SecurityGroupIds: options.securityGroupIds,
            KeyName: options.keyName,
            IamInstanceProfile: options.iamInstanceProfileArn ? { Arn: options.iamInstanceProfileArn } : undefined,
            UserData: userData(options, spec),
            TagSpecifications: tags(spec.name, spec.labels) as any
          })
        );
        const instance = response.Instances?.[0];
        const id = instance?.InstanceId ?? spec.name;
        const state = instance?.State?.Name === "running" ? "running" : "creating";
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.create",
              capabilityPath: "machine.create",
              startedAt,
              image: imageId,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "EC2 RunInstances is native.",
                  "EC2 is a low-level machine primitive; networking, IAM, SSH access, patching, and runtime hardening are not abstracted away by Capsule.",
                  "Environment values are only encoded into user data when provided; this is not a secret manager."
                ]
              },
              resource: { id, name: spec.name, status: state },
              metadata: { region: spec.region ?? options.region, instanceType, subnetId: options.subnetId, securityGroupIds: options.securityGroupIds }
            })
          : undefined;
        return { id, provider, name: spec.name, status: state, receipt };
      },
      status: async (spec: MachineStatusSpec, context: AdapterContext): Promise<MachineStatusResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new DescribeInstancesCommand({ InstanceIds: [spec.id] }));
        const instance = response.Reservations?.flatMap((reservation: any) => reservation.Instances ?? [])?.[0];
        const stateName = instance?.State?.Name ?? "unknown";
        const status = capsuleMachineState(stateName);
        const receipt = lifecycleReceipt(context, {
          type: "machine.status",
          capabilityPath: "machine.status",
          startedAt,
          id: spec.id,
          state: status,
          metadata: { awsState: stateName, region: options.region }
        });
        return { id: spec.id, provider, name: instance?.Tags?.find((tag: any) => tag.Key === "Name")?.Value, status, receipt, metadata: { awsState: stateName } };
      },
      start: async (spec: StartMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new StartInstancesCommand({ InstanceIds: [spec.id] }));
        const stateName = response.StartingInstances?.[0]?.CurrentState?.Name ?? "pending";
        const status = capsuleMachineState(stateName) === "running" ? "running" : "starting";
        const receipt = lifecycleReceipt(context, {
          type: "machine.start",
          capabilityPath: "machine.start",
          startedAt,
          id: spec.id,
          state: status,
          metadata: { awsState: stateName, reason: spec.reason, region: options.region }
        });
        return { id: spec.id, provider, status, receipt, metadata: { awsState: stateName } };
      },
      stop: async (spec: StopMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new StopInstancesCommand({ InstanceIds: [spec.id], Force: spec.force }));
        const stateName = response.StoppingInstances?.[0]?.CurrentState?.Name ?? "stopping";
        const status = stateName === "stopped" ? "stopped" : "stopping";
        const receipt = lifecycleReceipt(context, {
          type: "machine.stop",
          capabilityPath: "machine.stop",
          startedAt,
          id: spec.id,
          state: status,
          metadata: { awsState: stateName, force: spec.force, reason: spec.reason, region: options.region }
        });
        return { id: spec.id, provider, status, receipt, metadata: { awsState: stateName } };
      },
      destroy: async (spec: DestroyMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new TerminateInstancesCommand({ InstanceIds: [spec.id] }));
        const stateName = response.TerminatingInstances?.[0]?.CurrentState?.Name ?? "shutting-down";
        const status = stateName === "terminated" ? "deleted" : "destroying";
        const receipt = lifecycleReceipt(context, {
          type: "machine.destroy",
          capabilityPath: "machine.destroy",
          startedAt,
          id: spec.id,
          state: status,
          metadata: { awsState: stateName, force: spec.force, reason: spec.reason, region: options.region }
        });
        return { id: spec.id, provider, status, receipt, metadata: { awsState: stateName } };
      }
    }
  };
}
