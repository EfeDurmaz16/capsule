import {
  logsFromOutput,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateDatabaseBranchSpec,
  type DeleteDatabaseBranchSpec,
  type CreateMachineSpec,
  type CreatePreviewSpec,
  type CreateSandboxSpec,
  type DeployEdgeSpec,
  type DeployServiceSpec,
  type ExecResult,
  type ExecSpec,
  type FileEntry,
  type RunJobSpec,
  type Sandbox,
  type SandboxHandle
} from "@capsule/core";

interface MockAdapterOptions {
  name: string;
  provider: string;
  capabilities: CapabilityMap;
}

const sanitize = (value: string | undefined, fallback: string) => (value ?? fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-");
const id = (prefix: string, name?: string) => `${prefix}_${sanitize(name, "default")}`;

function hasDomain(capabilities: CapabilityMap, domain: keyof CapabilityMap): boolean {
  const entry = capabilities[domain];
  if (!entry) {
    return false;
  }
  return Object.values(entry).some((level) => level !== "unsupported");
}

function receiptNotes(provider: string): string[] {
  return [`${provider} adapter is a mock and did not call a real provider API.`];
}

class MockSandbox implements Sandbox {
  private readonly files = new Map<string, Uint8Array>();

  constructor(
    readonly handle: SandboxHandle,
    private readonly context: AdapterContext,
    private readonly adapterName: string
  ) {}

  async exec(spec: ExecSpec): Promise<ExecResult> {
    const startedAt = new Date();
    const command = typeof spec.command === "string" ? ["sh", "-lc", spec.command] : spec.command;
    const stdout = `mock:${this.handle.provider}: ${command.join(" ")}\n`;
    const stderr = "";
    const policy = this.context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
    const receipt = this.context.receipts
      ? this.context.createReceipt({
          type: "sandbox.exec",
          capabilityPath: "sandbox.exec",
          startedAt,
          command,
          cwd: spec.cwd,
          exitCode: 0,
          stdout,
          stderr,
          policy: { ...policy, notes: [...policy.notes, ...receiptNotes(this.adapterName)] },
          resource: { id: this.handle.id, status: "running" }
        })
      : undefined;
    return { exitCode: 0, stdout, stderr, logs: logsFromOutput(stdout, stderr), artifacts: [], receipt };
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    this.files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.files.get(path) ?? new TextEncoder().encode("");
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    return [...this.files.keys()]
      .filter((filePath) => filePath.startsWith(path))
      .map((filePath) => ({
        name: filePath.split("/").filter(Boolean).at(-1) ?? filePath,
        path: filePath,
        type: "file" as const,
        sizeBytes: this.files.get(filePath)?.byteLength
      }));
  }

  async destroy(): Promise<void> {
    this.files.clear();
  }
}

export function createMockAdapter(options: MockAdapterOptions): CapsuleAdapter {
  const { name, provider, capabilities } = options;
  const adapter: CapsuleAdapter = {
    name,
    provider,
    capabilities,
    raw: { mock: true, provider }
  };

  if (hasDomain(capabilities, "sandbox")) {
    adapter.sandbox = {
      create: async (spec: CreateSandboxSpec, context: AdapterContext) => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const handle: SandboxHandle = {
          id: id(`${provider}_sandbox`, spec.name),
          provider,
          createdAt: startedAt.toISOString(),
          metadata: { image: spec.image ?? "mock-runtime", name: spec.name }
        };
        if (context.receipts) {
          context.createReceipt({
            type: "sandbox.create",
            capabilityPath: "sandbox.create",
            startedAt,
            image: spec.image,
            policy: { ...policy, notes: [...policy.notes, ...receiptNotes(name)] },
            resource: { id: handle.id, name: spec.name, status: "running" }
          });
        }
        return new MockSandbox(handle, context, name);
      }
    };
  }

  if (hasDomain(capabilities, "job")) {
    adapter.job = {
      run: async (spec: RunJobSpec, context: AdapterContext) => {
        const startedAt = new Date();
        const command = typeof spec.command === "string" ? ["sh", "-lc", spec.command] : (spec.command ?? []);
        const stdout = `mock:${provider}: job ${spec.name ?? "run"} completed\n`;
        const stderr = "";
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const receipt = context.receipts
          ? context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt,
              image: spec.image,
              command,
              exitCode: 0,
              stdout,
              stderr,
              policy: { ...policy, notes: [...policy.notes, ...receiptNotes(name)] },
              resource: { id: spec.name, name: spec.name, status: "succeeded" }
            })
          : undefined;
        return {
          id: spec.name ?? id(`${provider}_job`),
          provider,
          status: "succeeded",
          result: { exitCode: 0, stdout, stderr, logs: logsFromOutput(stdout, stderr), artifacts: [], receipt },
          receipt
        };
      }
    };
  }

  if (hasDomain(capabilities, "service")) {
    adapter.service = {
      deploy: async (spec: DeployServiceSpec, context: AdapterContext) => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const deploymentId = id(`${provider}_service`, spec.name);
        const url = `https://${spec.name}.${provider}.mock.capsule.dev`;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "service.deploy",
              capabilityPath: "service.deploy",
              startedAt,
              image: spec.image,
              source: spec.source,
              policy: { ...policy, notes: [...policy.notes, ...receiptNotes(name)] },
              resource: { id: deploymentId, name: spec.name, url, status: "ready" }
            })
          : undefined;
        return { id: deploymentId, provider, name: spec.name, status: "ready", url, receipt };
      }
    };
  }

  if (hasDomain(capabilities, "edge")) {
    adapter.edge = {
      deploy: async (spec: DeployEdgeSpec, context: AdapterContext) => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const deploymentId = id(`${provider}_edge`, spec.name);
        const url = `https://${spec.name}.${provider}.edge.mock.capsule.dev`;
        const receipt = context.receipts
          ? context.createReceipt({
              type: "edge.deploy",
              capabilityPath: "edge.deploy",
              startedAt,
              source: spec.source,
              policy: { ...policy, notes: [...policy.notes, ...receiptNotes(name)] },
              resource: { id: deploymentId, name: spec.name, url, status: "ready" },
              metadata: { runtime: spec.runtime, routes: spec.routes, bindings: spec.bindings }
            })
          : undefined;
        return { id: deploymentId, provider, name: spec.name, status: "ready", url, receipt };
      }
    };
  }

  if (hasDomain(capabilities, "database")) {
    adapter.database = {
      branch: {
        create: async (spec: CreateDatabaseBranchSpec, context: AdapterContext) => {
          const startedAt = new Date();
          const branchId = id(`${provider}_branch`, spec.name);
          const connectionString = `postgresql://mock:mock@${provider}.mock.capsule.dev/${spec.name}`;
          const receipt = context.receipts
            ? context.createReceipt({
                type: "database.branch.create",
                capabilityPath: "database.branchCreate",
                startedAt,
                policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
                resource: { id: branchId, name: spec.name, status: "ready" },
                metadata: { project: spec.project, parent: spec.parent, ttlMs: spec.ttlMs }
              })
            : undefined;
          return {
            id: branchId,
            provider,
            project: spec.project,
            name: spec.name,
            parent: spec.parent,
            connectionString,
            status: "ready",
            receipt
          };
        },
        delete: async (spec: DeleteDatabaseBranchSpec, context: AdapterContext) => {
          const startedAt = new Date();
          const receipt = context.receipts
            ? context.createReceipt({
                type: "database.branch.delete",
                capabilityPath: "database.branchDelete",
                startedAt,
                policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
                resource: { id: spec.branchId, status: "deleted" },
                metadata: { project: spec.project, hardDelete: spec.hardDelete }
              })
            : undefined;
          return { id: spec.branchId, provider, project: spec.project, status: "deleted", receipt };
        }
      }
    };
  }

  if (hasDomain(capabilities, "preview")) {
    adapter.preview = {
      create: async (spec: CreatePreviewSpec, context: AdapterContext) => {
        const startedAt = new Date();
        const previewId = id(`${provider}_preview`, spec.name);
        const resources = [
          ...(spec.services ?? []).map((service) => ({ type: "service" as const, id: id(`${provider}_service`, service.name), provider, name: service.name })),
          ...(spec.edges ?? []).map((edge) => ({ type: "edge" as const, id: id(`${provider}_edge`, edge.name), provider, name: edge.name })),
          ...(spec.databases ?? []).map((database) => ({ type: "database" as const, id: id(`${provider}_database`, database.name), provider, name: database.name })),
          ...(spec.jobs ?? []).map((job) => ({ type: "job" as const, id: id(`${provider}_job`, job.name), provider, name: job.name }))
        ];
        const urls = [
          ...resources.filter((resource) => resource.type === "service" || resource.type === "edge").map((resource) => `https://${resource.name}.${provider}.preview.mock.capsule.dev`)
        ];
        const receipt = context.receipts
          ? context.createReceipt({
              type: "preview.create",
              capabilityPath: "preview.create",
              startedAt,
              source: spec.source,
              policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
              resource: { id: previewId, name: spec.name, status: "ready" },
              metadata: { ttlMs: spec.ttlMs, resources }
            })
          : undefined;
        return { id: previewId, provider, name: spec.name, status: "ready", urls, resources, receipt };
      }
    };
  }

  if (hasDomain(capabilities, "machine")) {
    adapter.machine = {
      create: async (spec: CreateMachineSpec, context: AdapterContext) => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const machineId = id(`${provider}_machine`, spec.name);
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.create",
              capabilityPath: "machine.create",
              startedAt,
              image: spec.image,
              policy: { ...policy, notes: [...policy.notes, ...receiptNotes(name), "Machine primitives are lower-level and intentionally leak provider details."] },
              resource: { id: machineId, name: spec.name, status: "running" },
              metadata: { region: spec.region, size: spec.size }
            })
          : undefined;
        return { id: machineId, provider, name: spec.name, status: "running", receipt };
      },
      status: async (spec, context) => {
        const startedAt = new Date();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.status",
              capabilityPath: "machine.status",
              startedAt,
              policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
              resource: { id: spec.id, status: "running" }
            })
          : undefined;
        return { id: spec.id, provider, status: "running", receipt };
      },
      start: async (spec, context) => {
        const startedAt = new Date();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.start",
              capabilityPath: "machine.start",
              startedAt,
              policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
              resource: { id: spec.id, status: "running" },
              metadata: { reason: spec.reason }
            })
          : undefined;
        return { id: spec.id, provider, status: "running", receipt };
      },
      stop: async (spec, context) => {
        const startedAt = new Date();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.stop",
              capabilityPath: "machine.stop",
              startedAt,
              policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
              resource: { id: spec.id, status: "stopped" },
              metadata: { force: spec.force, reason: spec.reason }
            })
          : undefined;
        return { id: spec.id, provider, status: "stopped", receipt };
      },
      destroy: async (spec, context) => {
        const startedAt = new Date();
        const receipt = context.receipts
          ? context.createReceipt({
              type: "machine.destroy",
              capabilityPath: "machine.destroy",
              startedAt,
              policy: { decision: "allowed", applied: context.policy, notes: receiptNotes(name) },
              resource: { id: spec.id, status: "deleted" },
              metadata: { force: spec.force, reason: spec.reason }
            })
          : undefined;
        return { id: spec.id, provider, status: "deleted", receipt };
      }
    };
  }

  return adapter;
}
