import { isIP } from "node:net";
import { posix } from "node:path";
import { Daytona } from "@daytona/sdk";
import {
  AdapterExecutionError,
  CleanupFailureError,
  PolicyViolationError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderValidationError,
  UnknownOutcomeError,
  asProviderError,
  callProvider,
  capsuleOperationTags,
  logsFromOutput,
  providerRuntimeMetadata,
  redactSecrets,
  resourceLocator,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateSandboxSpec,
  type ExecResult,
  type ExecSpec,
  type FileEntry,
  type Sandbox,
  type SandboxHandle
} from "@capsule-sdk/core";

// Shape of FileInfo in the installed @daytona/toolbox-api-client. It carries the entry name only; there
// is no path field, so entry paths are rebuilt from the requested directory.
interface DaytonaFileInfo {
  name: string;
  isDir: boolean;
  size: number;
  group?: string;
  owner?: string;
  mode?: string;
  modTime?: string;
  permissions?: string;
}

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
    listFiles(path: string): Promise<DaytonaFileInfo[]>;
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
  action: "delete-created-sandbox";
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
    // Declarations describe what Capsule can invoke today, not provider potential: there is no Capsule
    // snapshot API, CreateSandboxSpec exposedPorts is not mapped and ExecSpec.artifactPaths is not collected.
    snapshot: "unsupported",
    restore: "unsupported",
    exposePort: "unsupported",
    mountWorkspace: "unsupported",
    networkPolicy: "native",
    filesystemPolicy: "emulated",
    secretMounting: "emulated",
    streamingLogs: "unsupported",
    artifacts: "unsupported"
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

// Daytona and Modal enforce network allowlists as CIDR ranges only. A host or domain name cannot be
// represented, so it is rejected before any provider call instead of being sent as a CIDR the provider
// would misread or ignore. An allowlist with no entries allows nothing and maps to blocking all traffic.
type CidrAllowlist = { kind: "block-all" } | { kind: "cidrs"; cidrs: string[] } | undefined;

function cidrAllowlist(policy: AdapterContext["policy"], providerName: string): CidrAllowlist {
  if (policy.network?.mode !== "allowlist") return undefined;
  const entries = policy.network.allowedHosts ?? [];
  if (entries.length === 0) return { kind: "block-all" };
  const invalid = entries.filter((entry) => !isCidr(entry));
  if (invalid.length > 0) {
    throw new PolicyViolationError(
      `${providerName} network allowlists accept CIDR ranges only (for example 203.0.113.0/24); these allowedHosts entries cannot be enforced: ${invalid.join(", ")}.`,
      [`${providerName} cannot enforce host or domain allowlist entries; the sandbox was not created.`]
    );
  }
  return { kind: "cidrs", cidrs: entries };
}

function isCidr(value: string): boolean {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash !== value.lastIndexOf("/")) return false;
  const address = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const version = isIP(address);
  const bits = Number(prefix);
  return (version === 4 && bits <= 32) || (version === 6 && bits <= 128);
}

function createParams(spec: CreateSandboxSpec, context: AdapterContext, options: DaytonaAdapterOptions): Record<string, unknown> {
  const allowlist = cidrAllowlist(context.policy, "Daytona");
  return {
    name: spec.name,
    image: spec.image,
    language: options.language ?? "typescript",
    envVars: spec.env,
    labels: labelsWithOperationTag(spec.labels, spec.idempotencyKey),
    autoStopInterval: options.autoStopIntervalMinutes,
    ephemeral: options.ephemeral,
    networkBlockAll: context.policy.network?.mode === "none" || allowlist?.kind === "block-all" ? true : undefined,
    networkAllowList: allowlist?.kind === "cidrs" ? allowlist.cidrs.join(",") : undefined
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
  if (context.policy.network?.mode === "allowlist") {
    notes.push(
      (context.policy.network.allowedHosts ?? []).length === 0
        ? "Daytona networkBlockAll is requested because the network allowlist is empty."
        : "Daytona networkAllowList is requested from the CIDR ranges in Capsule allowedHosts."
    );
  }
  if (context.policy.filesystem) notes.push("Filesystem policy is emulated at Capsule adapter boundaries.");
  return notes;
}

// A refused request (auth, validation, rate limit) never started the command, so the typed provider
// error is returned as is. Any other failure (timeout, dropped connection, unknown server error) may have
// happened after the command started, so whether it ran is unknown and it is not safe to retry blindly.
function execFailure(error: unknown, sandboxId: string): Error {
  const providerError = asProviderError(error, "Daytona command execution failed.");
  if (providerError instanceof ProviderAuthError || providerError instanceof ProviderValidationError || providerError instanceof ProviderRateLimitError) {
    return providerError;
  }
  return new UnknownOutcomeError(
    `Daytona command outcome is unknown: ${providerError.message}`,
    { operation: "sandbox.exec", resource: resourceLocator({ provider, kind: "sandbox", nativeId: sandboxId }) },
    providerError
  );
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
      // executeCommand reports an ordinary nonzero exit as a normal response, so an exception here is a
      // provider or transport failure. The sandbox is caller-owned and may be a persistent workspace:
      // it is never deleted as a side effect of a failed exec. The caller decides with destroy().
      throw execFailure(error, this.handle.id);
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
    await callProvider("Daytona file write failed.", () => this.sandbox.fs.uploadFile(typeof data === "string" ? Buffer.from(data) : Buffer.from(data), path));
  }

  async readFile(path: string): Promise<Uint8Array> {
    return await callProvider("Daytona file read failed.", () => this.sandbox.fs.downloadFile(path));
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const entries = await callProvider("Daytona file list failed.", () => this.sandbox.fs.listFiles(path));
    return entries.map((entry) => ({
      name: entry.name,
      // Join with the requested directory so absolute and relative listings round-trip through readFile.
      path: posix.join(path, entry.name),
      type: entry.isDir === true ? "directory" : entry.isDir === false ? "file" : "unknown",
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
        const params = removeUndefined(createParams(spec, context, options));
        const sandbox = await callProvider("Daytona sandbox creation failed.", () => getClient().create(params, { timeout: timeoutSeconds(spec.timeoutMs) }));
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
