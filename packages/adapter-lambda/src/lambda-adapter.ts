import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  logsFromOutput,
  redactSecrets,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type ExecResult,
  type JobRun,
  type RunJobSpec
} from "@capsule/core";

interface LambdaClientLike {
  send(command: InvokeCommand): Promise<{
    $metadata?: {
      requestId?: string;
    };
    StatusCode?: number;
    FunctionError?: string;
    LogResult?: string;
    ExecutedVersion?: string;
    Payload?: Uint8Array;
  }>;
}

export interface LambdaAdapterOptions {
  region?: string;
  functionName?: string;
  qualifier?: string;
  invocationType?: "RequestResponse" | "Event" | "DryRun";
  logType?: "None" | "Tail";
  client?: LambdaClientLike;
}

const provider = "lambda";
const adapter = "lambda";

export const lambdaCapabilities: CapabilityMap = {
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
    status: "unsupported",
    cancel: "unsupported",
    logs: "experimental",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "emulated",
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
    routes: "unsupported",
    logs: "unsupported"
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

function commandForReceipt(command: string[] | string | undefined): string[] | undefined {
  if (!command) return undefined;
  return typeof command === "string" ? ["sh", "-lc", command] : command;
}

function payload(spec: RunJobSpec): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      capsule: true,
      image: spec.image,
      command: spec.command,
      env: spec.env,
      resources: spec.resources,
      labels: spec.labels
    })
  );
}

function decode(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function decodeLog(value: string | undefined): string {
  return value ? Buffer.from(value, "base64").toString("utf8") : "";
}

function status(statusCode: number | undefined, functionError: string | undefined, invocationType: LambdaAdapterOptions["invocationType"]): JobRun["status"] {
  if (invocationType === "Event") return statusCode && statusCode >= 200 && statusCode < 300 ? "queued" : "failed";
  if (functionError) return "failed";
  return statusCode && statusCode >= 200 && statusCode < 300 ? "succeeded" : "failed";
}

function receiptNotes(policyNotes: string[], invocationType: LambdaAdapterOptions["invocationType"]): string[] {
  const notes = [
    ...policyNotes,
    "AWS Lambda invoke is native for existing functions.",
    "Capsule passes env/command/image as event payload; it does not mutate Lambda environment variables or deploy function code.",
    "Lambda API status code does not imply function success when FunctionError is present."
  ];
  if (invocationType === "Event") {
    notes.push("Lambda async Event invocation only confirms enqueue; Capsule does not support provider-side async job.status for Lambda.");
  }
  return notes;
}

function defaultClient(options: LambdaAdapterOptions): LambdaClientLike {
  return new LambdaClient({ region: options.region });
}

export function lambda(options: LambdaAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => options.client ?? defaultClient(options);
  return {
    name: adapter,
    provider,
    capabilities: lambdaCapabilities,
    raw: { region: options.region, functionName: options.functionName, qualifier: options.qualifier },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const functionName = options.functionName ?? spec.name;
        if (!functionName) {
          throw new Error("Lambda adapter requires functionName option or RunJobSpec.name.");
        }
        const invocationType = options.invocationType ?? "RequestResponse";
        const response = await getClient().send(
          new InvokeCommand({
            FunctionName: functionName,
            InvocationType: invocationType,
            LogType: options.logType ?? "Tail",
            Qualifier: options.qualifier,
            Payload: payload(spec)
          })
        );
        const stdout = redactSecrets(decode(response.Payload), spec.env, context.policy);
        const stderr = response.FunctionError ?? "";
        const logs = decodeLog(response.LogResult);
        const runStatus = status(response.StatusCode, response.FunctionError, invocationType);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command: commandForReceipt(spec.command),
              exitCode: runStatus === "succeeded" ? 0 : runStatus === "failed" ? 1 : undefined,
              stdout,
              stderr,
              policy: {
                ...policy,
                notes: receiptNotes(policy.notes, invocationType)
              },
              resource: { id: functionName, name: functionName, status: runStatus },
              metadata: {
                invocationType,
                statusCode: response.StatusCode,
                requestId: response.$metadata?.requestId,
                executedVersion: response.ExecutedVersion ?? null,
                functionError: response.FunctionError ?? null,
                asyncStatusSupport: invocationType === "Event" ? "unsupported" : undefined,
                logTail: logs || undefined
              }
            })
          : undefined;
        const result: ExecResult | undefined =
          runStatus === "queued"
            ? undefined
            : { exitCode: runStatus === "succeeded" ? 0 : 1, stdout, stderr, logs: logsFromOutput(stdout, logs || stderr), artifacts: [], receipt };
        return { id: functionName, provider, status: runStatus, result, receipt };
      }
    }
  };
}
