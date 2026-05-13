import { UnsupportedCapabilityError } from "./errors.js";
import { supportLevel, supports, type CapabilityPath } from "./capabilities.js";
import { evaluatePolicy, mergeTimeout } from "./policy.js";
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

export interface CapsuleOptions {
  adapter: CapsuleAdapter;
  policy?: CapsulePolicy;
  receipts?: boolean;
  receiptPersistence?: ReceiptPersistenceMode;
  receiptStore?: ReceiptStore;
  receiptSigner?: ReceiptSigner;
}

export class Capsule {
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
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs });
        if (!this.options.adapter.sandbox) {
          throw new UnsupportedCapabilityError("sandbox.create");
        }
        return this.withContext((context) =>
          this.options.adapter.sandbox!.create(
            { ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) },
            context
          )
        );
      }
    };

    this.job = {
      run: async (spec: RunJobSpec) => {
        this.require("job.run");
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs });
        if (!this.options.adapter.job) {
          throw new UnsupportedCapabilityError("job.run");
        }
        return this.withContext((context) => this.options.adapter.job!.run({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, context));
      },
      status: async (spec: JobStatusSpec) => {
        this.require("job.status");
        if (!this.options.adapter.job?.status) {
          throw new UnsupportedCapabilityError("job.status");
        }
        return this.withContext((context) => this.options.adapter.job!.status!(spec, context));
      },
      cancel: async (spec: CancelJobSpec) => {
        this.require("job.cancel");
        if (!this.options.adapter.job?.cancel) {
          throw new UnsupportedCapabilityError("job.cancel");
        }
        return this.withContext((context) => this.options.adapter.job!.cancel!(spec, context));
      },
      logs: async (spec: JobLogsSpec) => {
        this.require("job.logs");
        if (!this.options.adapter.job?.logs) {
          throw new UnsupportedCapabilityError("job.logs");
        }
        return this.withContext((context) => this.options.adapter.job!.logs!(spec, context));
      }
    };

    this.service = {
      deploy: async (spec: DeployServiceSpec) => {
        this.require("service.deploy");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.service) {
          throw new UnsupportedCapabilityError("service.deploy");
        }
        return this.withContext((context) => this.options.adapter.service!.deploy(spec, context));
      },
      status: async (spec: ServiceStatusSpec) => {
        this.require("service.status");
        if (!this.options.adapter.service?.status) {
          throw new UnsupportedCapabilityError("service.status");
        }
        return this.withContext((context) => this.options.adapter.service!.status!(spec, context));
      },
      update: async (spec: UpdateServiceSpec) => {
        this.require("service.update");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.service?.update) {
          throw new UnsupportedCapabilityError("service.update");
        }
        return this.withContext((context) => this.options.adapter.service!.update!(spec, context));
      },
      rollback: async (spec: RollbackServiceSpec) => {
        this.require("service.rollback");
        if (!this.options.adapter.service?.rollback) {
          throw new UnsupportedCapabilityError("service.rollback");
        }
        return this.withContext((context) => this.options.adapter.service!.rollback!(spec, context));
      },
      delete: async (spec: DeleteServiceSpec) => {
        this.require("service.delete");
        if (!this.options.adapter.service?.delete) {
          throw new UnsupportedCapabilityError("service.delete");
        }
        return this.withContext((context) => this.options.adapter.service!.delete!(spec, context));
      },
      logs: async (spec: ServiceLogsSpec) => {
        this.require("service.logs");
        if (!this.options.adapter.service?.logs) {
          throw new UnsupportedCapabilityError("service.logs");
        }
        return this.withContext((context) => this.options.adapter.service!.logs!(spec, context));
      }
    };

    this.edge = {
      deploy: async (spec: DeployEdgeSpec) => {
        this.require("edge.deploy");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.edge) {
          throw new UnsupportedCapabilityError("edge.deploy");
        }
        return this.withContext((context) => this.options.adapter.edge!.deploy(spec, context));
      },
      status: async (spec: EdgeStatusSpec) => {
        this.require("edge.status");
        if (!this.options.adapter.edge?.status) {
          throw new UnsupportedCapabilityError("edge.status");
        }
        return this.withContext((context) => this.options.adapter.edge!.status!(spec, context));
      },
      version: async (spec: VersionEdgeSpec) => {
        this.require("edge.version");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.edge?.version) {
          throw new UnsupportedCapabilityError("edge.version");
        }
        return this.withContext((context) => this.options.adapter.edge!.version!(spec, context));
      },
      release: async (spec: ReleaseEdgeVersionSpec) => {
        this.require("edge.release");
        if (!this.options.adapter.edge?.release) {
          throw new UnsupportedCapabilityError("edge.release");
        }
        return this.withContext((context) => this.options.adapter.edge!.release!(spec, context));
      },
      rollback: async (spec: RollbackEdgeSpec) => {
        this.require("edge.rollback");
        if (!this.options.adapter.edge?.rollback) {
          throw new UnsupportedCapabilityError("edge.rollback");
        }
        return this.withContext((context) => this.options.adapter.edge!.rollback!(spec, context));
      },
      logs: async (spec: EdgeLogsSpec) => {
        this.require("edge.logs");
        if (!this.options.adapter.edge?.logs) {
          throw new UnsupportedCapabilityError("edge.logs");
        }
        return this.withContext((context) => this.options.adapter.edge!.logs!(spec, context));
      }
    };

    this.database = {
      branch: {
        create: async (spec: CreateDatabaseBranchSpec) => {
          this.require("database.branchCreate");
          if (!this.options.adapter.database) {
            throw new UnsupportedCapabilityError("database.branchCreate");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.create(spec, context));
        },
        delete: async (spec: DeleteDatabaseBranchSpec) => {
          this.require("database.branchDelete");
          if (!this.options.adapter.database?.branch.delete) {
            throw new UnsupportedCapabilityError("database.branchDelete");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.delete!(spec, context));
        },
        reset: async (spec: ResetDatabaseBranchSpec) => {
          this.require("database.branchReset");
          if (!this.options.adapter.database?.branch.reset) {
            throw new UnsupportedCapabilityError("database.branchReset");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.reset!(spec, context));
        }
      },
      migrate: async (spec: MigrateDatabaseSpec) => {
        this.require("database.migrate");
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs });
        if (!this.options.adapter.database?.migrate) {
          throw new UnsupportedCapabilityError("database.migrate");
        }
        return this.withContext((context) => this.options.adapter.database!.migrate!({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, context));
      }
    };

    this.preview = {
      create: async (spec: CreatePreviewSpec) => {
        this.require("preview.create");
        evaluatePolicy(this.options.policy, { timeoutMs: spec.ttlMs });
        if (!this.options.adapter.preview) {
          throw new UnsupportedCapabilityError("preview.create");
        }
        return this.withContext((context) => this.options.adapter.preview!.create(spec, context));
      },
      destroy: async (spec: DestroyPreviewSpec) => {
        this.require("preview.destroy");
        if (!this.options.adapter.preview?.destroy) {
          throw new UnsupportedCapabilityError("preview.destroy");
        }
        return this.withContext((context) => this.options.adapter.preview!.destroy!(spec, context));
      },
      status: async (spec: PreviewStatusSpec) => {
        this.require("preview.status");
        if (!this.options.adapter.preview?.status) {
          throw new UnsupportedCapabilityError("preview.status");
        }
        return this.withContext((context) => this.options.adapter.preview!.status!(spec, context));
      },
      logs: async (spec: PreviewLogsSpec) => {
        this.require("preview.logs");
        if (!this.options.adapter.preview?.logs) {
          throw new UnsupportedCapabilityError("preview.logs");
        }
        return this.withContext((context) => this.options.adapter.preview!.logs!(spec, context));
      },
      urls: async (spec: PreviewUrlsSpec) => {
        this.require("preview.urls");
        if (!this.options.adapter.preview?.urls) {
          throw new UnsupportedCapabilityError("preview.urls");
        }
        return this.withContext((context) => this.options.adapter.preview!.urls!(spec, context));
      },
      cleanup: async (spec: CleanupPreviewSpec) => {
        this.require("preview.cleanup");
        if (!this.options.adapter.preview?.cleanup) {
          throw new UnsupportedCapabilityError("preview.cleanup");
        }
        return this.withContext((context) => this.options.adapter.preview!.cleanup!(spec, context));
      }
    };

    this.machine = {
      create: async (spec: CreateMachineSpec) => {
        this.require("machine.create");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.machine) {
          throw new UnsupportedCapabilityError("machine.create");
        }
        return this.withContext((context) => this.options.adapter.machine!.create(spec, context));
      },
      status: async (spec: MachineStatusSpec) => {
        this.require("machine.status");
        if (!this.options.adapter.machine?.status) {
          throw new UnsupportedCapabilityError("machine.status");
        }
        return this.withContext((context) => this.options.adapter.machine!.status!(spec, context));
      },
      start: async (spec: StartMachineSpec) => {
        this.require("machine.start");
        if (!this.options.adapter.machine?.start) {
          throw new UnsupportedCapabilityError("machine.start");
        }
        return this.withContext((context) => this.options.adapter.machine!.start!(spec, context));
      },
      stop: async (spec: StopMachineSpec) => {
        this.require("machine.stop");
        if (!this.options.adapter.machine?.stop) {
          throw new UnsupportedCapabilityError("machine.stop");
        }
        return this.withContext((context) => this.options.adapter.machine!.stop!(spec, context));
      },
      destroy: async (spec: DestroyMachineSpec) => {
        this.require("machine.destroy");
        if (!this.options.adapter.machine?.destroy) {
          throw new UnsupportedCapabilityError("machine.destroy");
        }
        return this.withContext((context) => this.options.adapter.machine!.destroy!(spec, context));
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

  private async withContext<T>(operation: (context: AdapterContext) => Promise<T>): Promise<T> {
    const pendingWrites: Promise<void>[] = [];
    const context = this.context(pendingWrites);
    const result = await operation(context);
    if (this.receiptPersistenceMode() === "required") {
      await Promise.all(pendingWrites);
    }
    return result;
  }

  private receiptPersistenceMode(): ReceiptPersistenceMode {
    return this.options.receiptPersistence ?? "best-effort";
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

  private context(pendingWrites: Promise<void>[]): AdapterContext {
    const adapter = this.options.adapter;
    return {
      receipts: this.options.receipts ?? false,
      policy: this.options.policy ?? {},
      supportLevel: (path: string) => supportLevel(adapter.capabilities, path as CapabilityPath),
      evaluatePolicy: (input = {}) => evaluatePolicy(this.options.policy, input),
      createReceipt: (input) => {
        const receipt = createReceipt(
          {
            ...input,
            provider: adapter.provider,
            adapter: adapter.name,
            supportLevel: input.supportLevel ?? supportLevel(adapter.capabilities, input.capabilityPath as CapabilityPath)
          },
          this.options.receiptSigner
        );
        void this.persistReceipt(receipt, pendingWrites);
        return receipt;
      },
      recordReceipt: async (receipt) => {
        await this.persistReceipt(receipt, pendingWrites);
      }
    };
  }

  private require(path: CapabilityPath) {
    if (!this.supports(path)) {
      throw new UnsupportedCapabilityError(path);
    }
  }
}
