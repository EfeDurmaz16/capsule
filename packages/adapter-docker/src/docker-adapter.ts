import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateSandboxSpec,
  type ExecResult,
  type ExecSpec,
  type FileEntry,
  type RunJobSpec,
  type Sandbox,
  type SandboxHandle
} from "@capsule/core";
import { logsFromOutput, redactSecrets } from "@capsule/core";
import { dockerAvailable, runDocker } from "./docker-cli.js";

export interface DockerAdapterOptions {
  defaultImage?: string;
}

interface DockerSandboxCreateArgsInput {
  name: string;
  workdir: string;
  image: string;
  env?: Record<string, string>;
  networkNone?: boolean;
  exposedPorts?: CreateSandboxSpec["exposedPorts"];
}

const provider = "docker";
const adapter = "docker";

export const dockerCapabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    destroy: "native",
    snapshot: "unsupported",
    restore: "unsupported",
    exposePort: "native",
    networkPolicy: "experimental",
    filesystemPolicy: "emulated",
    secretMounting: "emulated",
    artifacts: "emulated"
  },
  job: {
    run: "native",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "emulated",
    timeout: "native",
    env: "native",
    resources: "experimental"
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

function normalizeCommand(command: string[] | string): string[] {
  return typeof command === "string" ? ["sh", "-lc", command] : command;
}

function policyNotes(context: AdapterContext): string[] {
  const notes: string[] = ["Docker local is not safe for hostile untrusted code unless the host Docker environment is hardened."];
  if (context.policy.network?.mode === "none") {
    notes.push("Docker network policy applied with --network none.");
  }
  if (context.policy.network?.mode === "allowlist") {
    notes.push("Docker adapter cannot enforce host allowlists natively; network allowlist is unsupported/best-effort.");
  }
  if (context.policy.filesystem) {
    notes.push("Filesystem policy is emulated at the Capsule adapter boundary, not enforced by the container runtime.");
  }
  return notes;
}

function envArgs(env?: Record<string, string>): string[] {
  return Object.entries(env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
}

function resourceArgs(resources?: { cpu?: number; memoryMb?: number }): string[] {
  return [
    ...(resources?.memoryMb ? ["--memory", `${resources.memoryMb}m`] : []),
    ...(resources?.cpu ? ["--cpus", String(resources.cpu)] : [])
  ];
}

function assertPort(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new AdapterExecutionError(`${label} must be an integer between 1 and 65535.`);
  }
}

function publishPortArgs(exposedPorts?: CreateSandboxSpec["exposedPorts"]): string[] {
  return (exposedPorts ?? []).flatMap((port) => {
    assertPort(port.containerPort, "containerPort");
    if (port.hostPort !== undefined) {
      assertPort(port.hostPort, "hostPort");
    }
    const protocol = port.protocol ?? "tcp";
    if (protocol !== "tcp" && protocol !== "udp") {
      throw new AdapterExecutionError("protocol must be tcp or udp.");
    }
    const hostIp = port.hostIp ?? "127.0.0.1";
    const hostPort = port.hostPort ?? "";
    return ["--publish", `${hostIp}:${hostPort}:${port.containerPort}/${protocol}`];
  });
}

export function dockerSandboxCreateArgs(input: DockerSandboxCreateArgsInput): string[] {
  return [
    "create",
    "--name",
    input.name,
    "--workdir",
    input.workdir,
    ...(input.networkNone ? ["--network", "none"] : []),
    ...publishPortArgs(input.exposedPorts),
    ...envArgs(input.env),
    input.image,
    "sh",
    "-lc",
    "mkdir -p /workspace && while :; do sleep 3600; done"
  ];
}

async function ensureDocker(): Promise<void> {
  if (!(await dockerAvailable())) {
    throw new AdapterExecutionError("Docker CLI is not available or the Docker daemon is not reachable.");
  }
}

class DockerSandbox implements Sandbox {
  constructor(
    readonly handle: SandboxHandle,
    private readonly context: AdapterContext
  ) {}

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const startedAt = new Date();
    const policy = this.context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
    const command = normalizeCommand(spec.command);
    const result = await runDocker(
      [
        "exec",
        ...(spec.cwd ? ["--workdir", spec.cwd] : []),
        ...envArgs(spec.env),
        this.handle.id,
        ...command
      ],
      { timeoutMs: spec.timeoutMs, input: spec.input }
    );
    const stdout = redactSecrets(result.stdout, spec.env, this.context.policy);
    const stderr = redactSecrets(result.stderr, spec.env, this.context.policy);
    const receipt = this.context.receipts
      ? this.context.createReceipt({
          type: "sandbox.exec",
          capabilityPath: "sandbox.exec",
          startedAt,
          command,
          cwd: spec.cwd,
          exitCode: result.exitCode,
          stdout,
          stderr,
          policy: { ...policy, notes: [...policy.notes, ...policyNotes(this.context)] },
          resource: { id: this.handle.id, status: "running" }
        })
      : undefined;
    return {
      exitCode: result.exitCode,
      stdout,
      stderr,
      logs: logsFromOutput(stdout, stderr),
      artifacts: [],
      receipt
    };
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "capsule-docker-write-"));
    try {
      const local = join(dir, basename(path));
      await writeFile(local, data);
      await runDocker(["exec", this.handle.id, "mkdir", "-p", dirname(path)]);
      const copied = await runDocker(["cp", local, `${this.handle.id}:${path}`]);
      if (copied.exitCode !== 0) {
        throw new AdapterExecutionError(`docker cp write failed: ${copied.stderr}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), "capsule-docker-read-"));
    try {
      const local = join(dir, basename(path));
      const copied = await runDocker(["cp", `${this.handle.id}:${path}`, local]);
      if (copied.exitCode !== 0) {
        throw new AdapterExecutionError(`docker cp read failed: ${copied.stderr}`);
      }
      return await readFile(local);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const command = `find ${JSON.stringify(path)} -maxdepth 1 -mindepth 1 -printf '%f\\t%p\\t%y\\t%s\\n'`;
    const result = await runDocker(["exec", this.handle.id, "sh", "-lc", command]);
    if (result.exitCode !== 0) {
      throw new AdapterExecutionError(`docker exec list failed: ${result.stderr}`);
    }
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", entryPath = "", kind = "unknown", size = ""] = line.split("\t");
        return {
          name,
          path: entryPath,
          type: kind === "f" ? "file" : kind === "d" ? "directory" : "unknown",
          sizeBytes: Number(size) || undefined
        };
      });
  }

  async destroy(): Promise<void> {
    const startedAt = new Date();
    await runDocker(["rm", "-f", this.handle.id], { timeoutMs: 20_000 });
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

export function docker(options: DockerAdapterOptions = {}): CapsuleAdapter {
  return {
    name: adapter,
    provider,
    capabilities: dockerCapabilities,
    raw: { cli: "docker" },
    sandbox: {
      create: async (spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox> => {
        await ensureDocker();
        const startedAt = new Date();
        const image = spec.image ?? options.defaultImage ?? "node:22";
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const name = spec.name ?? `capsule-${Date.now()}`;
        const create = await runDocker(
          dockerSandboxCreateArgs({
            name,
            workdir: spec.cwd ?? "/workspace",
            image,
            env: spec.env,
            networkNone: context.policy.network?.mode === "none",
            exposedPorts: spec.exposedPorts
          }),
          { timeoutMs: spec.timeoutMs }
        );
        if (create.exitCode !== 0) {
          throw new AdapterExecutionError(`docker create failed: ${create.stderr}`);
        }
        const id = create.stdout.trim();
        const start = await runDocker(["start", id], { timeoutMs: spec.timeoutMs });
        if (start.exitCode !== 0) {
          await runDocker(["rm", "-f", id]);
          throw new AdapterExecutionError(`docker start failed: ${start.stderr}`);
        }
        const handle: SandboxHandle = {
          id,
          provider,
          createdAt: startedAt.toISOString(),
          metadata: { image, name, exposedPorts: spec.exposedPorts ?? [] }
        };
        if (context.receipts) {
          context.createReceipt({
            type: "sandbox.create",
            capabilityPath: "sandbox.create",
            startedAt,
            image,
            policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
            resource: { id, name, status: "running" }
          });
        }
        return new DockerSandbox(handle, context);
      }
    },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext) => {
        await ensureDocker();
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const command = spec.command ? normalizeCommand(spec.command) : [];
        const result = await runDocker(
          [
            "run",
            "--rm",
            ...(context.policy.network?.mode === "none" ? ["--network", "none"] : []),
            ...envArgs(spec.env),
            ...resourceArgs(spec.resources),
            spec.image,
            ...command
          ],
          { timeoutMs: spec.timeoutMs }
        );
        const stdout = redactSecrets(result.stdout, spec.env, context.policy);
        const stderr = redactSecrets(result.stderr, spec.env, context.policy);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command,
              exitCode: result.exitCode,
              stdout,
              stderr,
              policy: { ...policy, notes: [...policy.notes, ...policyNotes(context)] },
              resource: { id: spec.name, name: spec.name, status: result.exitCode === 0 ? "succeeded" : "failed" }
            })
          : undefined;
        return {
          id: spec.name ?? `docker-job-${Date.now()}`,
          provider,
          status: result.exitCode === 0 ? "succeeded" : "failed",
          result: {
            exitCode: result.exitCode,
            stdout,
            stderr,
            logs: logsFromOutput(stdout, stderr),
            artifacts: [],
            receipt
          },
          receipt
        };
      }
    }
  };
}
