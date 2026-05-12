import { EC2Client, RunInstancesCommand } from "@aws-sdk/client-ec2";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateMachineSpec,
  type Machine
} from "@capsule/core";

interface EC2ClientLike {
  send(command: RunInstancesCommand): Promise<any>;
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
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported",
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
      }
    }
  };
}
