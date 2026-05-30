import { AsyncLocalStorage } from "node:async_hooks";
import { UnsupportedCapabilityError } from "./errors.js";
import { explainSupportLevel, supportLevel, supports, type CapabilityPath } from "./capabilities.js";
import { evaluatePolicy, mergeTimeout, type PolicyInput } from "./policy.js";
import { createReceipt } from "./receipts.js";
import type { AdapterContext, CapsuleAdapter } from "./adapters.js";
import type { ReceiptPersistenceMode, ReceiptStore } from "./stores.js";
import type {
  CapabilityMap,
  CapsuleReceipt,
  CancelJobSpec,
  CapsulePolicy,
  CleanupPreviewSpec,
  CreateDatabaseBranchSpec,
  DeleteDatabaseBranchSpec,
  DestroyPreviewSpec,
  DestroyMachineSpec,
  CreateMachineSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DeployEdgeSpec,
  DeployServiceSpec,
  DeleteServiceSpec,
  EdgeLogsSpec,
  EdgeStatusSpec,
  JobLogsSpec,
  JobStatusSpec,
  MigrateDatabaseSpec,
  MachineStatusSpec,
  PreviewLogsSpec,
  PreviewStatusSpec,
  PreviewUrlsSpec,
  ReleaseEdgeVersionSpec,
  ResetDatabaseBranchSpec,
  RollbackEdgeSpec,
  RollbackServiceSpec,
  RunJobSpec,
  ServiceLogsSpec,
  ServiceStatusSpec,
  StartMachineSpec,
  StopMachineSpec,
  UpdateServiceSpec,
  VersionEdgeSpec
} from "./types.js";
import type { ReceiptSigner } from "./receipts.js";
import type { ExecSpec, Sandbox } from "./types.js";

export interface CapsuleOptions {
  adapter: CapsuleAdapter;
  policy?: CapsulePolicy;
  receipts?: boolean;
  receiptPersistence?: ReceiptPersistenceMode;
  receiptStore?: ReceiptStore;
  receiptSigner?: ReceiptSigner;
}

interface ReceiptScope {
  type: CapsuleReceipt["type"];
  capabilityPath: CapabilityPath;
}

interface ContextOptions extends PolicyInput {
  receiptScopes?: ReceiptScope | readonly ReceiptScope[];
}

interface ContextRuntime {
  context: AdapterContext;
  defaultOptions: ContextOptions;
  pendingWrites: Promise<void>[];
  receipts: CapsuleReceipt[];
}

function receiptScope(type: CapsuleReceipt["type"], capabilityPath: CapabilityPath): ReceiptScope {
  return { type, capabilityPath };
}

const sandboxCreateReceiptScope = receiptScope("sandbox.create", "sandbox.create");
const sandboxExecReceiptScope = receiptScope("sandbox.exec", "sandbox.exec");
const sandboxFileWriteReceiptScope = receiptScope("sandbox.file.write", "sandbox.fileWrite");
const sandboxFileReadReceiptScope = receiptScope("sandbox.file.read", "sandbox.fileRead");
const sandboxFileListReceiptScope = receiptScope("sandbox.file.list", "sandbox.fileList");
const sandboxDestroyReceiptScope = receiptScope("sandbox.destroy", "sandbox.destroy");

function normalizeReceiptScopes(scopes: ReceiptScope | readonly ReceiptScope[] | undefined): readonly ReceiptScope[] {
  if (!scopes) {
    return [];
  }
  return "type" in scopes ? [scopes] : scopes;
}

function assertReceiptScope(input: { type: CapsuleReceipt["type"]; capabilityPath: string }, scopes: ReceiptScope | readonly ReceiptScope[] | undefined): void {
  const allowedScopes = normalizeReceiptScopes(scopes);
  if (allowedScopes.length === 0) {
    return;
  }
  if (allowedScopes.some((scope) => scope.type === input.type && scope.capabilityPath === input.capabilityPath)) {
    return;
  }
  const allowed = allowedScopes.map((scope) => `${scope.type}/${scope.capabilityPath}`).join(", ");
  throw new Error(`Adapter attempted to create receipt ${input.type}/${input.capabilityPath} outside active operation receipt scope. Expected one of: ${allowed}.`);
}

export class Capsule {
  private readonly contextOptions = new AsyncLocalStorage<ContextOptions>();

  readonly sandbox;
  readonly job;
  readonly service;
  readonly edge;
  readonly database;
  readonly preview;
  readonly machine;

  constructor(private readonly options: CapsuleOptions) {
    this.sandbox = {
      create: async (spec: CreateSandboxSpec) => {
        this.require("sandbox.create");
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs, approval: spec.approval });
        if (!this.options.adapter.sandbox) {
          throw new UnsupportedCapabilityError("sandbox.create");
        }
        const runtime = this.contextRuntime({ approval: spec.approval, receiptScopes: sandboxCreateReceiptScope });
        await this.preflightReceiptPersistence();
        const sandbox = await this.contextOptions.run(runtime.defaultOptions, () =>
          this.options.adapter.sandbox!.create({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, runtime.context)
        );
        if (this.receiptPersistenceMode() === "required") {
          await Promise.all(runtime.pendingWrites);
        }
        return this.wrapSandbox(sandbox, runtime, spec.approval);
      }
    };

    this.job = {
      run: async (spec: RunJobSpec) => {
        this.require("job.run");
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs, approval: spec.approval });
        if (!this.options.adapter.job) {
          throw new UnsupportedCapabilityError("job.run");
        }
        return this.withContext((context) => this.options.adapter.job!.run({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, context), {
          approval: spec.approval,
          receiptScopes: receiptScope("job.run", "job.run")
        });
      },
      status: async (spec: JobStatusSpec) => {
        this.require("job.status");
        if (!this.options.adapter.job?.status) {
          throw new UnsupportedCapabilityError("job.status");
        }
        return this.withContext((context) => this.options.adapter.job!.status!(spec, context), { receiptScopes: receiptScope("job.status", "job.status") });
      },
      cancel: async (spec: CancelJobSpec) => {
        this.require("job.cancel");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.job?.cancel) {
          throw new UnsupportedCapabilityError("job.cancel");
        }
        return this.withContext((context) => this.options.adapter.job!.cancel!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("job.cancel", "job.cancel") });
      },
      logs: async (spec: JobLogsSpec) => {
        this.require("job.logs");
        if (!this.options.adapter.job?.logs) {
          throw new UnsupportedCapabilityError("job.logs");
        }
        return this.withContext((context) => this.options.adapter.job!.logs!(spec, context), { receiptScopes: receiptScope("job.logs", "job.logs") });
      }
    };

    this.service = {
      deploy: async (spec: DeployServiceSpec) => {
        this.require("service.deploy");
        evaluatePolicy(this.options.policy, { env: spec.env, approval: spec.approval });
        if (!this.options.adapter.service) {
          throw new UnsupportedCapabilityError("service.deploy");
        }
        return this.withContext((context) => this.options.adapter.service!.deploy(spec, context), { approval: spec.approval, receiptScopes: receiptScope("service.deploy", "service.deploy") });
      },
      status: async (spec: ServiceStatusSpec) => {
        this.require("service.status");
        if (!this.options.adapter.service?.status) {
          throw new UnsupportedCapabilityError("service.status");
        }
        return this.withContext((context) => this.options.adapter.service!.status!(spec, context), { receiptScopes: receiptScope("service.status", "service.status") });
      },
      update: async (spec: UpdateServiceSpec) => {
        this.require("service.update");
        evaluatePolicy(this.options.policy, { env: spec.env, approval: spec.approval });
        if (!this.options.adapter.service?.update) {
          throw new UnsupportedCapabilityError("service.update");
        }
        return this.withContext((context) => this.options.adapter.service!.update!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("service.update", "service.update") });
      },
      rollback: async (spec: RollbackServiceSpec) => {
        this.require("service.rollback");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.service?.rollback) {
          throw new UnsupportedCapabilityError("service.rollback");
        }
        return this.withContext((context) => this.options.adapter.service!.rollback!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("service.rollback", "service.rollback") });
      },
      delete: async (spec: DeleteServiceSpec) => {
        this.require("service.delete");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.service?.delete) {
          throw new UnsupportedCapabilityError("service.delete");
        }
        return this.withContext((context) => this.options.adapter.service!.delete!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("service.delete", "service.delete") });
      },
      logs: async (spec: ServiceLogsSpec) => {
        this.require("service.logs");
        if (!this.options.adapter.service?.logs) {
          throw new UnsupportedCapabilityError("service.logs");
        }
        return this.withContext((context) => this.options.adapter.service!.logs!(spec, context), { receiptScopes: receiptScope("service.logs", "service.logs") });
      }
    };

    this.edge = {
      deploy: async (spec: DeployEdgeSpec) => {
        this.require("edge.deploy");
        evaluatePolicy(this.options.policy, { env: spec.env, approval: spec.approval });
        if (!this.options.adapter.edge) {
          throw new UnsupportedCapabilityError("edge.deploy");
        }
        return this.withContext((context) => this.options.adapter.edge!.deploy(spec, context), { approval: spec.approval, receiptScopes: receiptScope("edge.deploy", "edge.deploy") });
      },
      status: async (spec: EdgeStatusSpec) => {
        this.require("edge.status");
        if (!this.options.adapter.edge?.status) {
          throw new UnsupportedCapabilityError("edge.status");
        }
        return this.withContext((context) => this.options.adapter.edge!.status!(spec, context), { receiptScopes: receiptScope("edge.status", "edge.status") });
      },
      version: async (spec: VersionEdgeSpec) => {
        this.require("edge.version");
        evaluatePolicy(this.options.policy, { env: spec.env, approval: spec.approval });
        if (!this.options.adapter.edge?.version) {
          throw new UnsupportedCapabilityError("edge.version");
        }
        return this.withContext((context) => this.options.adapter.edge!.version!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("edge.version", "edge.version") });
      },
      release: async (spec: ReleaseEdgeVersionSpec) => {
        this.require("edge.release");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.edge?.release) {
          throw new UnsupportedCapabilityError("edge.release");
        }
        return this.withContext((context) => this.options.adapter.edge!.release!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("edge.release", "edge.release") });
      },
      rollback: async (spec: RollbackEdgeSpec) => {
        this.require("edge.rollback");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.edge?.rollback) {
          throw new UnsupportedCapabilityError("edge.rollback");
        }
        return this.withContext((context) => this.options.adapter.edge!.rollback!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("edge.rollback", "edge.rollback") });
      },
      logs: async (spec: EdgeLogsSpec) => {
        this.require("edge.logs");
        if (!this.options.adapter.edge?.logs) {
          throw new UnsupportedCapabilityError("edge.logs");
        }
        return this.withContext((context) => this.options.adapter.edge!.logs!(spec, context), { receiptScopes: receiptScope("edge.logs", "edge.logs") });
      }
    };

    this.database = {
      branch: {
        create: async (spec: CreateDatabaseBranchSpec) => {
          this.require("database.branchCreate");
          evaluatePolicy(this.options.policy, { ttlMs: spec.ttlMs, approval: spec.approval });
          if (!this.options.adapter.database) {
            throw new UnsupportedCapabilityError("database.branchCreate");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.create(spec, context), {
            approval: spec.approval,
            receiptScopes: receiptScope("database.branch.create", "database.branchCreate")
          });
        },
        delete: async (spec: DeleteDatabaseBranchSpec) => {
          this.require("database.branchDelete");
          evaluatePolicy(this.options.policy, { approval: spec.approval });
          if (!this.options.adapter.database?.branch.delete) {
            throw new UnsupportedCapabilityError("database.branchDelete");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.delete!(spec, context), {
            approval: spec.approval,
            receiptScopes: receiptScope("database.branch.delete", "database.branchDelete")
          });
        },
        reset: async (spec: ResetDatabaseBranchSpec) => {
          this.require("database.branchReset");
          evaluatePolicy(this.options.policy, { approval: spec.approval });
          if (!this.options.adapter.database?.branch.reset) {
            throw new UnsupportedCapabilityError("database.branchReset");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.reset!(spec, context), {
            approval: spec.approval,
            receiptScopes: receiptScope("database.branch.reset", "database.branchReset")
          });
        }
      },
      migrate: async (spec: MigrateDatabaseSpec) => {
        this.require("database.migrate");
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs, approval: spec.approval });
        if (!this.options.adapter.database?.migrate) {
          throw new UnsupportedCapabilityError("database.migrate");
        }
        return this.withContext((context) => this.options.adapter.database!.migrate!({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, context), {
          approval: spec.approval,
          receiptScopes: receiptScope("database.migrate", "database.migrate")
        });
      }
    };

    this.preview = {
      create: async (spec: CreatePreviewSpec) => {
        this.require("preview.create");
        evaluatePolicy(this.options.policy, { ttlMs: spec.ttlMs, approval: spec.approval });
        if (!this.options.adapter.preview) {
          throw new UnsupportedCapabilityError("preview.create");
        }
        return this.withContext((context) => this.options.adapter.preview!.create(spec, context), { approval: spec.approval, receiptScopes: receiptScope("preview.create", "preview.create") });
      },
      destroy: async (spec: DestroyPreviewSpec) => {
        this.require("preview.destroy");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.preview?.destroy) {
          throw new UnsupportedCapabilityError("preview.destroy");
        }
        return this.withContext((context) => this.options.adapter.preview!.destroy!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("preview.destroy", "preview.destroy") });
      },
      status: async (spec: PreviewStatusSpec) => {
        this.require("preview.status");
        if (!this.options.adapter.preview?.status) {
          throw new UnsupportedCapabilityError("preview.status");
        }
        return this.withContext((context) => this.options.adapter.preview!.status!(spec, context), { receiptScopes: receiptScope("preview.status", "preview.status") });
      },
      logs: async (spec: PreviewLogsSpec) => {
        this.require("preview.logs");
        if (!this.options.adapter.preview?.logs) {
          throw new UnsupportedCapabilityError("preview.logs");
        }
        return this.withContext((context) => this.options.adapter.preview!.logs!(spec, context), { receiptScopes: receiptScope("preview.logs", "preview.logs") });
      },
      urls: async (spec: PreviewUrlsSpec) => {
        this.require("preview.urls");
        if (!this.options.adapter.preview?.urls) {
          throw new UnsupportedCapabilityError("preview.urls");
        }
        return this.withContext((context) => this.options.adapter.preview!.urls!(spec, context), { receiptScopes: receiptScope("preview.urls", "preview.urls") });
      },
      cleanup: async (spec: CleanupPreviewSpec) => {
        this.require("preview.cleanup");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.preview?.cleanup) {
          throw new UnsupportedCapabilityError("preview.cleanup");
        }
        return this.withContext((context) => this.options.adapter.preview!.cleanup!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("preview.cleanup", "preview.cleanup") });
      }
    };

    this.machine = {
      create: async (spec: CreateMachineSpec) => {
        this.require("machine.create");
        evaluatePolicy(this.options.policy, { env: spec.env, approval: spec.approval });
        if (!this.options.adapter.machine) {
          throw new UnsupportedCapabilityError("machine.create");
        }
        return this.withContext((context) => this.options.adapter.machine!.create(spec, context), { approval: spec.approval, receiptScopes: receiptScope("machine.create", "machine.create") });
      },
      status: async (spec: MachineStatusSpec) => {
        this.require("machine.status");
        if (!this.options.adapter.machine?.status) {
          throw new UnsupportedCapabilityError("machine.status");
        }
        return this.withContext((context) => this.options.adapter.machine!.status!(spec, context), { receiptScopes: receiptScope("machine.status", "machine.status") });
      },
      start: async (spec: StartMachineSpec) => {
        this.require("machine.start");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.machine?.start) {
          throw new UnsupportedCapabilityError("machine.start");
        }
        return this.withContext((context) => this.options.adapter.machine!.start!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("machine.start", "machine.start") });
      },
      stop: async (spec: StopMachineSpec) => {
        this.require("machine.stop");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.machine?.stop) {
          throw new UnsupportedCapabilityError("machine.stop");
        }
        return this.withContext((context) => this.options.adapter.machine!.stop!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("machine.stop", "machine.stop") });
      },
      destroy: async (spec: DestroyMachineSpec) => {
        this.require("machine.destroy");
        evaluatePolicy(this.options.policy, { approval: spec.approval });
        if (!this.options.adapter.machine?.destroy) {
          throw new UnsupportedCapabilityError("machine.destroy");
        }
        return this.withContext((context) => this.options.adapter.machine!.destroy!(spec, context), { approval: spec.approval, receiptScopes: receiptScope("machine.destroy", "machine.destroy") });
      }
    };
  }

  capabilities(): CapabilityMap {
    return this.options.adapter.capabilities;
  }

  supports(path: CapabilityPath): boolean {
    return supports(this.options.adapter.capabilities, path);
  }

  supportLevel(path: CapabilityPath) {
    return supportLevel(this.options.adapter.capabilities, path);
  }

  adapterName(): string {
    return this.options.adapter.name;
  }

  raw(): unknown {
    return this.options.adapter.raw;
  }

  policy(): CapsulePolicy {
    return this.options.policy ?? {};
  }

  private async withContext<T>(operation: (context: AdapterContext) => Promise<T>, options: ContextOptions = {}): Promise<T> {
    const runtime = this.contextRuntime(options);
    await this.preflightReceiptPersistence();
    const result = await this.contextOptions.run(runtime.defaultOptions, () => operation(runtime.context));
    if (this.receiptPersistenceMode() === "required") {
      await Promise.all(runtime.pendingWrites);
    }
    return result;
  }

  private contextRuntime(defaultOptions: ContextOptions): ContextRuntime {
    const runtime: ContextRuntime = {
      context: undefined as unknown as AdapterContext,
      defaultOptions,
      pendingWrites: [],
      receipts: []
    };
    runtime.context = this.context(runtime);
    return runtime;
  }

  private async withSandboxSubOperation<T>(runtime: ContextRuntime, options: ContextOptions, operation: () => Promise<T>): Promise<T> {
    await this.preflightReceiptPersistence();
    const pendingStart = runtime.pendingWrites.length;
    const result = await this.contextOptions.run(options, operation);
    if (this.receiptPersistenceMode() === "required") {
      await Promise.all(runtime.pendingWrites.slice(pendingStart));
    }
    return result;
  }

  private wrapSandbox(sandbox: Sandbox, runtime: ContextRuntime, approval: PolicyInput["approval"]): Sandbox {
    return {
      handle: sandbox.handle,
      exec: async (spec: ExecSpec) => {
        this.require("sandbox.exec");
        const startedAt = new Date();
        const policy = evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs, approval });
        const receiptStart = runtime.receipts.length;
        return this.withSandboxSubOperation(runtime, { approval, receiptScopes: sandboxExecReceiptScope }, async () => {
          const result = await sandbox.exec({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) });
          if ((this.options.receipts ?? false) && runtime.receipts.length === receiptStart) {
            const receipt = runtime.context.createReceipt({
              type: "sandbox.exec",
              capabilityPath: "sandbox.exec",
              startedAt,
              command: normalizeCommand(spec.command),
              cwd: spec.cwd,
              providerOptions: spec.providerOptions,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              artifacts: result.artifacts,
              policy,
              resource: { id: sandbox.handle.id, status: "running" }
            });
            return { ...result, receipt };
          }
          return result;
        });
      },
      writeFile: async (path: string, data: string | Uint8Array) => {
        this.require("sandbox.fileWrite");
        const startedAt = new Date();
        const policy = evaluatePolicy(this.options.policy, { approval });
        const receiptStart = runtime.receipts.length;
        await this.withSandboxSubOperation(runtime, { approval, receiptScopes: sandboxFileWriteReceiptScope }, async () => {
          await sandbox.writeFile(path, data);
          if ((this.options.receipts ?? false) && runtime.receipts.length === receiptStart) {
            runtime.context.createReceipt({
              type: "sandbox.file.write",
              capabilityPath: "sandbox.fileWrite",
              startedAt,
              policy,
              resource: { id: sandbox.handle.id, status: "running" },
              metadata: { path, byteLength: byteLength(data) }
            });
          }
        });
      },
      readFile: async (path: string) => {
        this.require("sandbox.fileRead");
        const startedAt = new Date();
        const policy = evaluatePolicy(this.options.policy, { approval });
        const receiptStart = runtime.receipts.length;
        return this.withSandboxSubOperation(runtime, { approval, receiptScopes: sandboxFileReadReceiptScope }, async () => {
          const data = await sandbox.readFile(path);
          if ((this.options.receipts ?? false) && runtime.receipts.length === receiptStart) {
            runtime.context.createReceipt({
              type: "sandbox.file.read",
              capabilityPath: "sandbox.fileRead",
              startedAt,
              policy,
              resource: { id: sandbox.handle.id, status: "running" },
              metadata: { path, byteLength: data.byteLength }
            });
          }
          return data;
        });
      },
      listFiles: async (path: string) => {
        this.require("sandbox.fileList");
        const startedAt = new Date();
        const policy = evaluatePolicy(this.options.policy, { approval });
        const receiptStart = runtime.receipts.length;
        return this.withSandboxSubOperation(runtime, { approval, receiptScopes: sandboxFileListReceiptScope }, async () => {
          const entries = await sandbox.listFiles(path);
          if ((this.options.receipts ?? false) && runtime.receipts.length === receiptStart) {
            runtime.context.createReceipt({
              type: "sandbox.file.list",
              capabilityPath: "sandbox.fileList",
              startedAt,
              policy,
              resource: { id: sandbox.handle.id, status: "running" },
              metadata: { path, entryCount: entries.length }
            });
          }
          return entries;
        });
      },
      destroy: async () => {
        this.require("sandbox.destroy");
        const startedAt = new Date();
        const policy = evaluatePolicy(this.options.policy, { approval });
        const receiptStart = runtime.receipts.length;
        await this.withSandboxSubOperation(runtime, { approval, receiptScopes: sandboxDestroyReceiptScope }, async () => {
          await sandbox.destroy();
          if ((this.options.receipts ?? false) && runtime.receipts.length === receiptStart) {
            runtime.context.createReceipt({
              type: "sandbox.destroy",
              capabilityPath: "sandbox.destroy",
              startedAt,
              policy,
              resource: { id: sandbox.handle.id, status: "deleted" }
            });
          }
        });
      }
    };
  }

  private receiptPersistenceMode(): ReceiptPersistenceMode {
    return this.options.receiptPersistence ?? "best-effort";
  }

  private async preflightReceiptPersistence(): Promise<void> {
    if (!(this.options.receipts ?? false) || this.receiptPersistenceMode() !== "required") {
      return;
    }
    if (!this.options.receiptStore) {
      throw new Error("Receipt persistence is required but no receiptStore is configured.");
    }
    await this.options.receiptStore.ready?.();
  }

  private persistReceipt(receipt: CapsuleReceipt, pendingWrites: Promise<void>[]): Promise<void> {
    const mode = this.receiptPersistenceMode();
    if (!this.options.receiptStore) {
      if (mode === "best-effort") {
        return Promise.resolve();
      }
      const missingStore = Promise.reject(new Error("Receipt persistence is required but no receiptStore is configured."));
      pendingWrites.push(missingStore);
      missingStore.catch(() => undefined);
      return missingStore;
    }

    let write: Promise<void>;
    try {
      write = Promise.resolve(this.options.receiptStore.write(receipt));
    } catch (error) {
      write = Promise.reject(error);
    }
    if (mode === "required") {
      pendingWrites.push(write);
      write.catch(() => undefined);
      return write;
    }
    write.catch(() => undefined);
    return Promise.resolve();
  }

  private context(runtime: ContextRuntime): AdapterContext {
    const adapter = this.options.adapter;
    return {
      receipts: this.options.receipts ?? false,
      policy: this.options.policy ?? {},
      supportLevel: (path: string) => supportLevel(adapter.capabilities, path as CapabilityPath),
      evaluatePolicy: (input = {}) => {
        const options = this.contextOptions.getStore() ?? runtime.defaultOptions;
        return evaluatePolicy(this.options.policy, { ...input, approval: input.approval ?? options.approval });
      },
      createReceipt: (input) => {
        const options = this.contextOptions.getStore() ?? runtime.defaultOptions;
        assertReceiptScope(input, options.receiptScopes);
        const receipt = createReceipt(
          {
            ...input,
            provider: adapter.provider,
            adapter: adapter.name,
            supportLevel: input.supportLevel ?? supportLevel(adapter.capabilities, input.capabilityPath as CapabilityPath)
          },
          this.options.receiptSigner
        );
        runtime.receipts.push(receipt);
        void this.persistReceipt(receipt, runtime.pendingWrites);
        return receipt;
      }
    };
  }

  private require(path: CapabilityPath) {
    if (!this.supports(path)) {
      throw new UnsupportedCapabilityError(path, explainSupportLevel(this.options.adapter.capabilities, path).guidance);
    }
  }
}

function normalizeCommand(command: ExecSpec["command"]): string[] {
  return Array.isArray(command) ? command : [command];
}

function byteLength(data: string | Uint8Array): number {
  return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}
