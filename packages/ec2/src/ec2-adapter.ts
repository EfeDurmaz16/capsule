import {
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand
} from "@aws-sdk/client-ec2";
import {
  AdapterExecutionError,
  asProviderError,
  capsuleOperationTag,
  capsuleOperationTags,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateMachineSpec,
  type DestroyMachineSpec,
  type Machine,
  type MachineLifecycleResult,
  type MachineStatus,
  type MachineStatusResult,
  type MachineStatusSpec,
  type StartMachineSpec,
  type StopMachineSpec
} from "@capsule-sdk/core";

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

function classifiedClient(client: EC2ClientLike): EC2ClientLike {
  return {
    send: async (command) => {
      try {
        return await client.send(command);
      } catch (error) {
        throw asProviderError(error, "EC2 API request failed.");
      }
    }
  };
}

/**
 * Native RunInstances ClientToken for a caller idempotency key (GAP-17): a 32-hex hash of the key scoped
 * to this adapter and region, so the raw key never reaches AWS. EC2 returns the original instance for a
 * retried request with the same token and parameters and rejects a reused token with different
 * parameters (IdempotentParameterMismatch). This is provider retry deduplication within the AWS token
 * window, not exactly-once execution across arbitrary Capsule calls.
 */
function ec2ClientToken(idempotencyKey: string | undefined, region: string | undefined): string | undefined {
  return capsuleOperationTag({ idempotencyKey, capabilityPath: "machine.create", idempotencyScope: `ec2:machine.create:${region ?? "sdk-default-region"}` });
}

function tags(name: string, labels?: Record<string, string>, idempotencyKey?: string) {
  return [
    {
      ResourceType: "instance",
      Tags: [
        { Key: "Name", Value: name },
        { Key: "ManagedBy", Value: "capsule" },
        ...Object.entries({ ...(labels ?? {}), ...(capsuleOperationTags({ idempotencyKey, capabilityPath: "machine.create" }) ?? {}) }).map(([Key, Value]) => ({
          Key,
          Value
        }))
      ]
    }
  ];
}

const shellIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Wraps a value in POSIX single quotes so the shell performs no expansion of any kind. */
function shellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function validateEnv(env: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!shellIdentifier.test(key)) {
      throw new AdapterExecutionError(`EC2 machine.create env name ${JSON.stringify(key)} is not a valid shell variable name.`);
    }
    if (typeof value !== "string" || value.includes("\0")) {
      throw new AdapterExecutionError(`EC2 machine.create env value for ${key} must be a string without NUL characters.`);
    }
  }
}

/**
 * Generated user data exports each env entry as a single-quoted shell literal, so dollars, backticks,
 * quotes and newlines reach the variable unchanged. The exports exist only inside the user-data script
 * process; they do not configure the environment of later logins, services or runner processes.
 * `options.userData` replaces the generated script entirely.
 */
function userData(options: EC2AdapterOptions, spec: CreateMachineSpec): string | undefined {
  const payload = options.userData
    ? options.userData
    : spec.env && Object.keys(spec.env).length > 0
      ? `#!/bin/sh\n${Object.entries(spec.env)
          .map(([key, value]) => `export ${key}=${shellLiteral(value)}`)
          .join("\n")}\n`
      : undefined;
  return payload ? Buffer.from(payload).toString("base64") : undefined;
}

function envDeliveryNotes(options: EC2AdapterOptions, spec: CreateMachineSpec): string[] {
  if (!spec.env || Object.keys(spec.env).length === 0) return [];
  if (options.userData) return ["Adapter userData replaces the generated script, so spec.env is not delivered to the instance."];
  return ["Environment values are exported only inside the user-data script process; they do not persist into later logins, services or runner processes."];
}

// EC2 InstanceStateName values (AWS-02). Transitional native states map to transitional Capsule states:
// stopping is not stopped and shutting-down is not terminated. pending is reported as creating because
// DescribeInstances does not distinguish a first launch from a restart; the native value stays in
// metadata.awsState.
const ec2MachineStates: Readonly<Record<string, MachineStatus>> = Object.freeze({
  pending: "creating",
  running: "running",
  stopping: "stopping",
  stopped: "stopped",
  "shutting-down": "destroying",
  terminated: "deleted"
});

function capsuleMachineState(instanceId: string, state: string | undefined): MachineStatus {
  const mapped = state === undefined ? undefined : ec2MachineStates[state];
  if (!mapped) {
    // An unrecognized or missing native state is not evidence of failure; refuse to invent one.
    throw new AdapterExecutionError(
      state === undefined
        ? `EC2 DescribeInstances returned no instance state for ${instanceId}.`
        : `EC2 reported unrecognized instance state ${JSON.stringify(state)} for ${instanceId}.`,
      { instanceId, awsState: state ?? null }
    );
  }
  return mapped;
}

function providerBoolean(options: DestroyMachineSpec["providerOptions"], key: string): boolean | undefined {
  const value = options?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  throw new AdapterExecutionError(`EC2 machine.destroy providerOptions.${key} must be a boolean.`);
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
    notes?: string[];
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
            "AWS state transitions are asynchronous; returned state is what EC2 reported for this API response.",
            ...(input.notes ?? [])
          ]
        },
        resource: { id: input.id, status: input.state },
        metadata: input.metadata
      })
    : undefined;
}

export function ec2(options: EC2AdapterOptions = {}): CapsuleAdapter {
  // One classified client per adapter, created on first use (AWS-05). An injected client stays
  // caller-owned; the default SDK client is built lazily so constructing the adapter resolves no
  // credentials, and reusing it keeps the SDK keep-alive connection pool and credential cache warm.
  let cachedClient: EC2ClientLike | undefined;
  const getClient = (): EC2ClientLike => (cachedClient ??= classifiedClient(options.client ?? defaultClient(options)));
  return {
    name: adapter,
    provider,
    capabilities: ec2Capabilities,
    raw: { region: options.region, subnetId: options.subnetId, securityGroupIds: options.securityGroupIds },
    machine: {
      create: async (spec: CreateMachineSpec, context: AdapterContext): Promise<Machine> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        validateEnv(spec.env);
        if (spec.region !== undefined && spec.region !== options.region) {
          // The SDK client is bound to the adapter region; a different spec.region can be neither honored
          // nor recorded truthfully, so refuse before any request (GAP-12).
          throw new AdapterExecutionError(
            `EC2 machine.create spec.region ${JSON.stringify(spec.region)} does not match the adapter region ${JSON.stringify(options.region ?? null)}. Create an ec2 adapter for that region instead.`
          );
        }
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
            ClientToken: ec2ClientToken(spec.idempotencyKey, options.region),
            TagSpecifications: tags(spec.name, spec.labels, spec.idempotencyKey) as any
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
                  "Environment values are only encoded into user data when provided; this is not a secret manager.",
                  ...(spec.idempotencyKey
                    ? [
                        "idempotencyKey is sent as a hashed RunInstances ClientToken scoped to the adapter region; EC2 deduplicates retries with identical parameters within its token window and rejects reuse with different parameters. It is not an exactly-once guarantee."
                      ]
                    : []),
                  ...envDeliveryNotes(options, spec)
                ]
              },
              resource: { id, name: spec.name, status: state },
              metadata: { region: options.region, instanceType, subnetId: options.subnetId, securityGroupIds: options.securityGroupIds }
            })
          : undefined;
        return { id, provider, name: spec.name, status: state, receipt };
      },
      status: async (spec: MachineStatusSpec, context: AdapterContext): Promise<MachineStatusResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new DescribeInstancesCommand({ InstanceIds: [spec.id] }));
        const instance = response.Reservations?.flatMap((reservation: any) => reservation.Instances ?? [])?.[0];
        const stateName: string | undefined = instance?.State?.Name;
        const status = capsuleMachineState(spec.id, stateName);
        const receipt = lifecycleReceipt(context, {
          type: "machine.status",
          capabilityPath: "machine.status",
          startedAt,
          id: spec.id,
          state: status,
          metadata: { awsState: stateName, region: options.region }
        });
        return {
          id: spec.id,
          provider,
          name: instance?.Tags?.find((tag: { Key?: string; Value?: string }) => tag.Key === "Name")?.Value,
          status,
          receipt,
          metadata: { awsState: stateName }
        };
      },
      start: async (spec: StartMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        const response = await getClient().send(new StartInstancesCommand({ InstanceIds: [spec.id] }));
        const stateName = response.StartingInstances?.[0]?.CurrentState?.Name ?? "pending";
        const status = stateName === "running" ? "running" : "starting";
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
        const skipOsShutdown = providerBoolean(spec.providerOptions, "skipOsShutdown");
        const response = await getClient().send(new TerminateInstancesCommand({ InstanceIds: [spec.id], Force: spec.force, SkipOsShutdown: skipOsShutdown }));
        const termination =
          response.TerminatingInstances?.find((instance: { InstanceId?: string }) => instance.InstanceId === spec.id) ?? response.TerminatingInstances?.[0];
        const stateName = termination?.CurrentState?.Name;
        if (!stateName) {
          throw new AdapterExecutionError(`EC2 machine.destroy did not return termination state for ${spec.id}.`, { response, instanceId: spec.id });
        }
        const previousStateName = termination?.PreviousState?.Name;
        const status = stateName === "terminated" ? "deleted" : "destroying";
        const receipt = lifecycleReceipt(context, {
          type: "machine.destroy",
          capabilityPath: "machine.destroy",
          startedAt,
          id: spec.id,
          state: status,
          metadata: {
            awsState: stateName,
            previousAwsState: previousStateName,
            force: spec.force,
            skipOsShutdown,
            reason: spec.reason,
            region: options.region
          },
          notes: [
            "EC2 TerminateInstances force requests still attempt graceful shutdown first; providerOptions.skipOsShutdown bypasses OS shutdown and can risk data integrity."
          ]
        });
        return {
          id: spec.id,
          provider,
          status,
          receipt,
          metadata: { awsState: stateName, previousAwsState: previousStateName, force: spec.force, skipOsShutdown }
        };
      }
    }
  };
}
