import { Image, ModalClient } from "modal";
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

interface ModalReadStreamLike {
  readText(): Promise<string>;
}

interface ModalProcessLike {
  stdout: ModalReadStreamLike;
  stderr: ModalReadStreamLike;
  wait(): Promise<number>;
}

interface ModalFileLike {
  read(): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface ModalSandboxLike {
  sandboxId: string;
  exec(command: string[], params?: Record<string, unknown>): Promise<ModalProcessLike>;
  open(path: string, mode?: string): Promise<ModalFileLike>;
  terminate(params?: { wait?: boolean }): Promise<void | number>;
}

interface ModalClientLike {
  apps: { fromName(name: string, params?: Record<string, unknown>): Promise<unknown> };
  images: { fromRegistry(tag: string): unknown };
  sandboxes: { create(app: unknown, image: unknown, params?: Record<string, unknown>): Promise<ModalSandboxLike> };
}

export interface ModalAdapterOptions {
  appName?: string;
  defaultImage?: string;
  tokenId?: string;
  tokenSecret?: string;
  environment?: string;
  client?: ModalClientLike;
}

const provider = "modal";
const adapter = "modal";

export const modalCapabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "unsupported",
    destroy: "native",
    snapshot: "experimental",
    restore: "unsupported",
    exposePort: "experimental",
    networkPolicy: "native",
    filesystemPolicy: "emulated",
    secretMounting: "experimental",
    streamingLogs: "native",
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

function defaultClient(options: ModalAdapterOptions): ModalClientLike {
  return new ModalClient({ tokenId: options.tokenId, tokenSecret: options.tokenSecret, environment: options.environment }) as unknown as ModalClientLike;
}

function command(commandValue: string[] | string): string[] {
  return typeof commandValue === "string" ? ["sh", "-lc", commandValue] : commandValue;
}

function policyNotes(context: AdapterContext): string[] {
  const notes = ["Modal sandbox isolation is provided by Modal, not by Capsule itself."];
  if (context.policy.network?.mode === "none") notes.push("Modal blockNetwork is requested for this sandbox.");
  if (context.policy.network?.mode === "allowlist") notes.push("Modal cidrAllowlist is requested from Capsule allowedHosts.");
  if (context.policy.filesystem) notes.push("Filesystem policy is emulated at Capsule adapter boundaries.");
  return notes;
}

class ModalCapsuleSandbox implements Sandbox {
  constructor(
    private readonly sandbox: ModalSandboxLike,
    readonly handle: SandboxHandle,
    private readonly context: AdapterContext
  ) {}

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const startedAt = new Date();
    const policy = this.context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
    const proc = await this.sandbox.exec(command(spec.command), { workdir: spec.cwd, env: spec.env, timeoutMs: spec.timeoutMs, mode: "text" });
    const [exitCode, stdoutRaw, stderrRaw] = await Promise.all([proc.wait(), proc.stdout.readText(), proc.stderr.readText()]);
    const stdout = redactSecrets(stdoutRaw, spec.env, this.context.policy);
    const stderr = redactSecrets(stderrRaw, spec.env, this.context.policy);
    const receipt = this.context.receipts
      ? this.context.createReceipt({
          type: "sandbox.exec",
          capabilityPath: "sandbox.exec",
          startedAt,
          command: command(spec.command),
          cwd: spec.cwd,
          exitCode,
          stdout,
          stderr,
          policy: { ...policy, notes: [...policy.notes, ...policyNotes(this.context)] },
          resource: { id: this.handle.id, status: "running" }
        })
      : undefined;
    return { exitCode, stdout, stderr, logs: logsFromOutput(stdout, stderr), artifacts: [], receipt };
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const file = await this.sandbox.open(path, "w");
    try {
      await file.write(typeof data === "string" ? new TextEncoder().encode(data) : data);
      await file.flush();
    } finally {
      await file.close();
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const file = await this.sandbox.open(path, "r");
    try {
      return await file.read();
    } finally {
      await file.close();
    }
  }

  async listFiles(): Promise<FileEntry[]> {
    throw new AdapterExecutionError("Modal adapter does not expose a stable high-level file listing API yet.");
  }

  async destroy(): Promise<void> {
    const startedAt = new Date();
    await this.sandbox.terminate();
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

export function modal(options: ModalAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => options.client ?? defaultClient(options);
  return {
    name: adapter,
    provider,
    capabilities: modalCapabilities,
    raw: { appName: options.appName ?? "capsule", environment: options.environment },
    sandbox: {
      create: async (spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const client = getClient();
        const app = await client.apps.fromName(options.appName ?? "capsule", { createIfMissing: true, environment: options.environment });
        const image = client.images.fromRegistry(spec.image ?? options.defaultImage ?? "debian:bookworm-slim");
        const sandbox = await client.sandboxes.create(app, image, {
          name: spec.name,
          env: spec.env,
          timeoutMs: spec.timeoutMs,
          workdir: spec.cwd,
          blockNetwork: context.policy.network?.mode === "none" ? true : undefined,
          cidrAllowlist: context.policy.network?.mode === "allowlist" ? context.policy.network.allowedHosts : undefined
        });
        const handle: SandboxHandle = { id: sandbox.sandboxId, provider, createdAt: new Date().toISOString(), metadata: { appName: options.appName ?? "capsule" } };
        if (context.receipts) {
          context.createReceipt({
            type: "sandbox.create",
            capabilityPath: "sandbox.create",
            startedAt,
            image: spec.image ?? options.defaultImage,
            policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
            resource: { id: sandbox.sandboxId, name: spec.name, status: "running" }
          });
        }
        return new ModalCapsuleSandbox(sandbox, handle, context);
      }
    }
  };
}
