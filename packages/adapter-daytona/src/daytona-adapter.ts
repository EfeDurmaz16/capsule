import { Daytona } from "@daytona/sdk";
import {
  AdapterExecutionError,
  CleanupFailureError,
  capsuleOperationTags,
  logsFromOutput,
  providerRuntimeMetadata,
  redactSecrets,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateSandboxSpec,
  type ExecResult,
  type ExecSpec,
  type FileEntry,
  type Sandbox,
  type SandboxHandle
} from "@capsule/core";

interface DaytonaSandboxLike {
  id: string;
  name?: string;
  state?: string;
  createdAt?: string;
  process: {
    executeCommand(command: string, cwd?: string, env?: Record<string, string>, timeoutSeconds?: number): Promise<{ exitCode: number; result: string }>;
  };
  fs: {
    uploadFile(file: Buffer | string, remotePath: string, timeoutSeconds?: number): Promise<void>;
    downloadFile(remotePath: string, timeoutSeconds?: number): Promise<Buffer>;
    listFiles(path: string): Promise<Array<Record<string, unknown>>>;
  };
  delete(timeoutSeconds?: number): Promise<void>;
}

interface DaytonaClientLike {
  create(params?: Record<string, unknown>, options?: { timeout?: number }): Promise<DaytonaSandboxLike>;
}

export interface DaytonaAdapterOptions {
  apiKey?: string;
  apiUrl?: string;
  target?: string;
  language?: "typescript" | "javascript" | "python" | string;
  autoStopIntervalMinutes?: number;
  ephemeral?: boolean;
  client?: DaytonaClientLike;
}

interface DaytonaSandboxCleanupMetadata {
  action: "delete-created-sandbox" | "delete-sandbox-after-exec-error";
  sandboxId: string;
  status: "deleted" | "failed";
  error?: string;
}

type CleanupAwareError = Error & { cleanup?: DaytonaSandboxCleanupMetadata };

const provider = "daytona";
const adapter = "daytona";
const adapterVersion = "0.1.1";

export const daytonaCapabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    upload: "native",
    download: "native",
    destroy: "native",
    snapshot: "experimental",
    restore: "unsupported",
    exposePort: "experimental",
    mountWorkspace: "unsupported",
    networkPolicy: "native",
    filesystemPolicy: "emulated",
    secretMounting: "emulated",
    streamingLogs: "unsupported",
    artifacts: "emulated"
  },
  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported"
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
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }
};

function commandToString(command: string[] | string): string {
  return typeof command === "string" ? command : command.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ");
}

function commandForReceipt(command: string[] | string): string[] {
  return typeof command === "string" ? ["sh", "-lc", command] : command;
}

function timeoutSeconds(timeoutMs?: number): number | undefined {
  return timeoutMs === undefined ? undefined : Math.ceil(timeoutMs / 1000);
}

function createParams(spec: CreateSandboxSpec, context: AdapterContext, options: DaytonaAdapterOptions): Record<string, unknown> {
  return {
    name: spec.name,
    image: spec.image,
    language: options.language ?? "typescript",
    envVars: spec.env,
    labels: labelsWithOperationTag(spec.labels, spec.idempotencyKey),
    autoStopInterval: options.autoStopIntervalMinutes,
    ephemeral: options.ephemeral,
    networkBlockAll: context.policy.network?.mode === "none" ? true : undefined,
    networkAllowList: context.policy.network?.mode === "allowlist" ? context.policy.network.allowedHosts?.join(",") : undefined
  };
}

function labelsWithOperationTag(labels: Record<string, string> | undefined, idempotencyKey: string | undefined): Record<string, string> | undefined {
  const merged = { ...(labels ?? {}), ...(capsuleOperationTags({ idempotencyKey, capabilityPath: "sandbox.create" }) ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function daytonaReceiptMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...providerRuntimeMetadata({ adapterVersion }),
    ...metadata
  };
}

function defaultClient(options: DaytonaAdapterOptions): DaytonaClientLike {
  return new Daytona({ apiKey: options.apiKey, apiUrl: options.apiUrl, target: options.target }) as unknown as DaytonaClientLike;
}

function policyNotes(context: AdapterContext): string[] {
  const notes = ["Daytona sandbox isolation is provided by Daytona, not by Capsule itself."];
  if (context.policy.network?.mode === "none") notes.push("Daytona networkBlockAll is requested for this sandbox.");
  if (context.policy.network?.mode === "allowlist") notes.push("Daytona networkAllowList is requested from Capsule allowedHosts.");
  if (context.policy.filesystem) notes.push("Filesystem policy is emulated at Capsule adapter boundaries.");
  return notes;
}

function fileType(entry: Record<string, unknown>): FileEntry["type"] {
  if (entry.type === "dir" || entry.type === "directory" || entry.isDir === true) return "directory";
  if (entry.type === "file" || entry.isDir === false) return "file";
  return "unknown";
}

async function deleteSandboxAfterFailure(
  sandbox: DaytonaSandboxLike,
  action: DaytonaSandboxCleanupMetadata["action"],
  operationError: unknown
): Promise<never> {
  const cleanup: DaytonaSandboxCleanupMetadata = {
    action,
    sandboxId: sandbox.id,
    status: "deleted"
  };
  try {
    await sandbox.delete();
  } catch (cleanupError) {
    cleanup.status = "failed";
    cleanup.error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
  if (cleanup.status === "failed") {
    throw new CleanupFailureError("Daytona sandbox cleanup failed after sandbox allocation.", cleanup, { operationError });
  }
  if (operationError instanceof Error) {
    (operationError as CleanupAwareError).cleanup = cleanup;
    throw operationError;
  }
  throw new AdapterExecutionError("Daytona sandbox operation failed after sandbox allocation.", { operationError, cleanup });
}

class DaytonaCapsuleSandbox implements Sandbox {
  constructor(
    private readonly sandbox: DaytonaSandboxLike,
    readonly handle: SandboxHandle,
    private readonly context: AdapterContext
  ) {}

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const startedAt = new Date();
    const policy = this.context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
    let response: { exitCode: number; result: string };
    try {
      response = await this.sandbox.process.executeCommand(commandToString(spec.command), spec.cwd, spec.env, timeoutSeconds(spec.timeoutMs));
    } catch (error) {
      return await deleteSandboxAfterFailure(this.sandbox, "delete-sandbox-after-exec-error", error);
    }
    const stdout = redactSecrets(response.result, spec.env, this.context.policy);
    const stderr = "";
    const receipt = this.context.receipts
      ? this.context.createReceipt({
          type: "sandbox.exec",
          capabilityPath: "sandbox.exec",
          startedAt,
          command: commandForReceipt(spec.command),
          cwd: spec.cwd,
          exitCode: response.exitCode,
          stdout,
          stderr,
          policy: { ...policy, notes: [...policy.notes, ...policyNotes(this.context)] },
          resource: { id: this.handle.id, status: this.sandbox.state ?? "started" },
          metadata: daytonaReceiptMetadata({ state: this.sandbox.state })
        })
      : undefined;
    return { exitCode: response.exitCode, stdout, stderr, logs: logsFromOutput(stdout, stderr), artifacts: [], receipt };
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    await this.sandbox.fs.uploadFile(typeof data === "string" ? Buffer.from(data) : Buffer.from(data), path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return await this.sandbox.fs.downloadFile(path);
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const entries = await this.sandbox.fs.listFiles(path);
    return entries.map((entry) => ({
      name: String(entry.name ?? String(entry.path ?? "").split("/").filter(Boolean).at(-1) ?? ""),
      path: String(entry.path ?? entry.name ?? ""),
      type: fileType(entry),
      sizeBytes: typeof entry.size === "number" ? entry.size : undefined
    }));
  }

  async destroy(): Promise<void> {
    const startedAt = new Date();
    await this.sandbox.delete();
    if (this.context.receipts) {
      this.context.createReceipt({
        type: "sandbox.destroy",
        capabilityPath: "sandbox.destroy",
        startedAt,
        policy: { decision: "allowed", applied: this.context.policy, notes: policyNotes(this.context) },
        resource: { id: this.handle.id, status: "deleted" },
        metadata: daytonaReceiptMetadata()
      });
    }
  }
}

export function daytona(options: DaytonaAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => options.client ?? defaultClient(options);
  return {
    name: adapter,
    provider,
    capabilities: daytonaCapabilities,
    raw: { apiUrl: options.apiUrl, target: options.target },
    sandbox: {
      create: async (spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const sandbox = await getClient().create(removeUndefined(createParams(spec, context, options)), { timeout: timeoutSeconds(spec.timeoutMs) });
        const handle: SandboxHandle = {
          id: sandbox.id,
          provider,
          createdAt: sandbox.createdAt ?? new Date().toISOString(),
          metadata: { name: sandbox.name, state: sandbox.state }
        };
        try {
          if (context.receipts) {
            context.createReceipt({
              type: "sandbox.create",
              capabilityPath: "sandbox.create",
              startedAt,
              image: spec.image,
              policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
              resource: { id: sandbox.id, name: sandbox.name, status: sandbox.state ?? "started" },
              metadata: daytonaReceiptMetadata({ name: sandbox.name, state: sandbox.state })
            });
          }
          return new DaytonaCapsuleSandbox(sandbox, handle, context);
        } catch (error) {
          return await deleteSandboxAfterFailure(sandbox, "delete-created-sandbox", error);
        }
      }
    }
  };
}
