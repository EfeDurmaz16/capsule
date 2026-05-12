import { Sandbox as E2BSandbox } from "e2b";
import {
  AdapterExecutionError,
  logsFromOutput,
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

interface E2BCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

interface E2BEntryInfo {
  name?: string;
  path: string;
  type?: "file" | "dir" | string;
  size?: number;
}

interface E2BSandboxInstance {
  sandboxId: string;
  sandboxDomain?: string;
  commands: {
    run(
      command: string,
      options?: {
        cwd?: string;
        envs?: Record<string, string>;
        timeoutMs?: number;
        background?: false;
        stdin?: boolean;
      }
    ): Promise<E2BCommandResult>;
  };
  files: {
    write(path: string, data: string | ArrayBuffer | Blob | ReadableStream): Promise<unknown>;
    read(path: string, options: { format: "bytes" }): Promise<Uint8Array>;
    list(path: string, options?: { depth?: number }): Promise<E2BEntryInfo[]>;
  };
  kill(): Promise<void>;
}

interface E2BSandboxClass {
  create(options?: Record<string, unknown>): Promise<E2BSandboxInstance>;
  create(template: string, options?: Record<string, unknown>): Promise<E2BSandboxInstance>;
}

export interface E2BAdapterOptions {
  apiKey?: string;
  defaultTemplate?: string;
  defaultCwd?: string;
  secure?: boolean;
  sandboxClass?: E2BSandboxClass;
}

const provider = "e2b";
const adapter = "e2b";

export const e2bCapabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    upload: "native",
    download: "native",
    destroy: "native",
    snapshot: "unsupported",
    restore: "unsupported",
    exposePort: "experimental",
    mountWorkspace: "unsupported",
    networkPolicy: "native",
    filesystemPolicy: "emulated",
    secretMounting: "emulated",
    streamingLogs: "experimental",
    artifacts: "emulated"
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
    create: "unsupported",
    exec: "unsupported",
    start: "unsupported",
    stop: "unsupported",
    destroy: "unsupported"
  }
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandToString(command: string[] | string): string {
  return typeof command === "string" ? command : command.map(shellQuote).join(" ");
}

function commandForReceipt(command: string[] | string): string[] {
  return typeof command === "string" ? ["sh", "-lc", command] : command;
}

function arrayBufferFromBytes(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

function policyNotes(context: AdapterContext): string[] {
  const notes: string[] = ["E2B isolation is provided by the E2B cloud sandbox provider, not by Capsule itself."];
  if (context.policy.network?.mode === "none") {
    notes.push("E2B internet access is disabled with allowInternetAccess=false for this sandbox.");
  }
  if (context.policy.network?.mode === "allowlist") {
    notes.push("Host allowlist network policy is not modeled by this adapter yet; enforcement is delegated/best-effort.");
  }
  if (context.policy.filesystem) {
    notes.push("Filesystem policy is emulated at the Capsule adapter boundary, not enforced inside the E2B VM.");
  }
  return notes;
}

function createOptions(spec: CreateSandboxSpec, context: AdapterContext, options: E2BAdapterOptions): Record<string, unknown> {
  return {
    apiKey: options.apiKey,
    envs: spec.env,
    timeoutMs: spec.timeoutMs,
    secure: options.secure,
    allowInternetAccess: context.policy.network?.mode === "none" ? false : undefined,
    metadata: {
      ...(spec.name ? { name: spec.name } : {}),
      ...(spec.labels ?? {})
    }
  };
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function toFileType(type: E2BEntryInfo["type"]): FileEntry["type"] {
  if (type === "file") return "file";
  if (type === "dir" || type === "directory") return "directory";
  return "unknown";
}

class E2BCapsuleSandbox implements Sandbox {
  constructor(
    private readonly sandbox: E2BSandboxInstance,
    readonly handle: SandboxHandle,
    private readonly context: AdapterContext,
    private readonly defaultCwd: string | undefined
  ) {}

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const startedAt = new Date();
    const policy = this.context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
    const command = commandToString(spec.command);
    const receiptCommand = commandForReceipt(spec.command);
    const result = await this.sandbox.commands.run(command, {
      cwd: spec.cwd ?? this.defaultCwd,
      envs: spec.env,
      timeoutMs: spec.timeoutMs,
      background: false
    });
    const stdout = redactSecrets(result.stdout, spec.env, this.context.policy);
    const stderr = redactSecrets(result.stderr, spec.env, this.context.policy);
    const receipt = this.context.receipts
      ? this.context.createReceipt({
          type: "sandbox.exec",
          capabilityPath: "sandbox.exec",
          startedAt,
          command: receiptCommand,
          cwd: spec.cwd ?? this.defaultCwd,
          exitCode: result.exitCode,
          stdout,
          stderr,
          policy: { ...policy, notes: [...policy.notes, ...policyNotes(this.context)] },
          resource: { id: this.handle.id, status: "running" },
          metadata: result.error ? { error: result.error } : undefined
        })
      : undefined;
    return { exitCode: result.exitCode, stdout, stderr, logs: logsFromOutput(stdout, stderr), artifacts: [], receipt };
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    await this.sandbox.files.write(path, typeof data === "string" ? data : arrayBufferFromBytes(data));
  }

  async readFile(path: string): Promise<Uint8Array> {
    return await this.sandbox.files.read(path, { format: "bytes" });
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const entries = await this.sandbox.files.list(path, { depth: 1 });
    return entries.map((entry) => ({
      name: entry.name ?? entry.path.split("/").filter(Boolean).at(-1) ?? entry.path,
      path: entry.path,
      type: toFileType(entry.type),
      sizeBytes: entry.size
    }));
  }

  async destroy(): Promise<void> {
    const startedAt = new Date();
    await this.sandbox.kill();
    if (this.context.receipts) {
      this.context.createReceipt({
        type: "sandbox.destroy",
        capabilityPath: "sandbox.destroy",
        startedAt,
        policy: { decision: "allowed", applied: this.context.policy, notes: policyNotes(this.context) },
        resource: { id: this.handle.id, status: "deleted" }
      });
    }
  }
}

export function e2b(options: E2BAdapterOptions = {}): CapsuleAdapter {
  const sandboxClass = options.sandboxClass ?? (E2BSandbox as unknown as E2BSandboxClass);
  return {
    name: adapter,
    provider,
    capabilities: e2bCapabilities,
    raw: { sdk: "e2b", template: options.defaultTemplate ?? "base" },
    sandbox: {
      create: async (spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const sandboxOptions = removeUndefined(createOptions(spec, context, options));
        const template = spec.image ?? options.defaultTemplate;
        const sandbox = template ? await sandboxClass.create(template, sandboxOptions) : await sandboxClass.create(sandboxOptions);
        const handle: SandboxHandle = {
          id: sandbox.sandboxId,
          provider,
          createdAt: new Date().toISOString(),
          metadata: {
            domain: sandbox.sandboxDomain,
            template: template ?? "base"
          }
        };
        if (context.receipts) {
          context.createReceipt({
            type: "sandbox.create",
            capabilityPath: "sandbox.create",
            startedAt,
            image: template,
            policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
            resource: { id: sandbox.sandboxId, status: "running" },
            metadata: { domain: sandbox.sandboxDomain, labels: spec.labels }
          });
        }
        return new E2BCapsuleSandbox(sandbox, handle, context, spec.cwd ?? options.defaultCwd);
      }
    }
  };
}
