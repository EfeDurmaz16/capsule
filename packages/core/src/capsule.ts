import { UnsupportedCapabilityError } from "./errors.js";
import { supportLevel, supports, type CapabilityPath } from "./capabilities.js";
import { evaluatePolicy, mergeTimeout } from "./policy.js";
import { createReceipt } from "./receipts.js";
import type { AdapterContext, CapsuleAdapter } from "./adapters.js";
import type { ReceiptStore } from "./stores.js";
import type {
  CapabilityMap,
  CancelJobSpec,
  CapsulePolicy,
  CreateDatabaseBranchSpec,
  DeleteDatabaseBranchSpec,
  CreateMachineSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DeployEdgeSpec,
  DeployServiceSpec,
  DeleteServiceSpec,
  EdgeStatusSpec,
  JobStatusSpec,
  MigrateDatabaseSpec,
  ReleaseEdgeVersionSpec,
  ResetDatabaseBranchSpec,
  RollbackEdgeSpec,
  RunJobSpec,
  ServiceStatusSpec,
  UpdateServiceSpec,
  VersionEdgeSpec
} from "./types.js";

export interface CapsuleOptions {
  adapter: CapsuleAdapter;
  policy?: CapsulePolicy;
  receipts?: boolean;
  receiptStore?: ReceiptStore;
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
        return this.options.adapter.sandbox.create(
          { ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) },
          this.context()
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
        return this.options.adapter.job.run({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, this.context());
      },
      status: async (spec: JobStatusSpec) => {
        this.require("job.status");
        if (!this.options.adapter.job?.status) {
          throw new UnsupportedCapabilityError("job.status");
        }
        return this.options.adapter.job.status(spec, this.context());
      },
      cancel: async (spec: CancelJobSpec) => {
        this.require("job.cancel");
        if (!this.options.adapter.job?.cancel) {
          throw new UnsupportedCapabilityError("job.cancel");
        }
        return this.options.adapter.job.cancel(spec, this.context());
      }
    };

    this.service = {
      deploy: async (spec: DeployServiceSpec) => {
        this.require("service.deploy");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.service) {
          throw new UnsupportedCapabilityError("service.deploy");
        }
        return this.options.adapter.service.deploy(spec, this.context());
      },
      status: async (spec: ServiceStatusSpec) => {
        this.require("service.status");
        if (!this.options.adapter.service?.status) {
          throw new UnsupportedCapabilityError("service.status");
        }
        return this.options.adapter.service.status(spec, this.context());
      },
      update: async (spec: UpdateServiceSpec) => {
        this.require("service.update");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.service?.update) {
          throw new UnsupportedCapabilityError("service.update");
        }
        return this.options.adapter.service.update(spec, this.context());
      },
      delete: async (spec: DeleteServiceSpec) => {
        this.require("service.delete");
        if (!this.options.adapter.service?.delete) {
          throw new UnsupportedCapabilityError("service.delete");
        }
        return this.options.adapter.service.delete(spec, this.context());
      }
    };

    this.edge = {
      deploy: async (spec: DeployEdgeSpec) => {
        this.require("edge.deploy");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.edge) {
          throw new UnsupportedCapabilityError("edge.deploy");
        }
        return this.options.adapter.edge.deploy(spec, this.context());
      },
      status: async (spec: EdgeStatusSpec) => {
        this.require("edge.status");
        if (!this.options.adapter.edge?.status) {
          throw new UnsupportedCapabilityError("edge.status");
        }
        return this.options.adapter.edge.status(spec, this.context());
      },
      version: async (spec: VersionEdgeSpec) => {
        this.require("edge.version");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.edge?.version) {
          throw new UnsupportedCapabilityError("edge.version");
        }
        return this.options.adapter.edge.version(spec, this.context());
      },
      release: async (spec: ReleaseEdgeVersionSpec) => {
        this.require("edge.release");
        if (!this.options.adapter.edge?.release) {
          throw new UnsupportedCapabilityError("edge.release");
        }
        return this.options.adapter.edge.release(spec, this.context());
      },
      rollback: async (spec: RollbackEdgeSpec) => {
        this.require("edge.rollback");
        if (!this.options.adapter.edge?.rollback) {
          throw new UnsupportedCapabilityError("edge.rollback");
        }
        return this.options.adapter.edge.rollback(spec, this.context());
      }
    };

    this.database = {
      branch: {
        create: async (spec: CreateDatabaseBranchSpec) => {
          this.require("database.branchCreate");
          if (!this.options.adapter.database) {
            throw new UnsupportedCapabilityError("database.branchCreate");
          }
          return this.options.adapter.database.branch.create(spec, this.context());
        },
        delete: async (spec: DeleteDatabaseBranchSpec) => {
          this.require("database.branchDelete");
          if (!this.options.adapter.database?.branch.delete) {
            throw new UnsupportedCapabilityError("database.branchDelete");
          }
          return this.options.adapter.database.branch.delete(spec, this.context());
        },
        reset: async (spec: ResetDatabaseBranchSpec) => {
          this.require("database.branchReset");
          if (!this.options.adapter.database?.branch.reset) {
            throw new UnsupportedCapabilityError("database.branchReset");
          }
          return this.options.adapter.database.branch.reset(spec, this.context());
        }
      },
      migrate: async (spec: MigrateDatabaseSpec) => {
        this.require("database.migrate");
        evaluatePolicy(this.options.policy, { env: spec.env, timeoutMs: spec.timeoutMs });
        if (!this.options.adapter.database?.migrate) {
          throw new UnsupportedCapabilityError("database.migrate");
        }
        return this.options.adapter.database.migrate({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, this.context());
      }
    };

    this.preview = {
      create: async (spec: CreatePreviewSpec) => {
        this.require("preview.create");
        evaluatePolicy(this.options.policy, { timeoutMs: spec.ttlMs });
        if (!this.options.adapter.preview) {
          throw new UnsupportedCapabilityError("preview.create");
        }
        return this.options.adapter.preview.create(spec, this.context());
      }
    };

    this.machine = {
      create: async (spec: CreateMachineSpec) => {
        this.require("machine.create");
        evaluatePolicy(this.options.policy, { env: spec.env });
        if (!this.options.adapter.machine) {
          throw new UnsupportedCapabilityError("machine.create");
        }
        return this.options.adapter.machine.create(spec, this.context());
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

  private context(): AdapterContext {
    const adapter = this.options.adapter;
    return {
      receipts: this.options.receipts ?? false,
      policy: this.options.policy ?? {},
      supportLevel: (path: string) => supportLevel(adapter.capabilities, path as CapabilityPath),
      evaluatePolicy: (input = {}) => evaluatePolicy(this.options.policy, input),
      createReceipt: (input) => {
        const receipt = createReceipt({
          ...input,
          provider: adapter.provider,
          adapter: adapter.name,
          supportLevel: input.supportLevel ?? supportLevel(adapter.capabilities, input.capabilityPath as CapabilityPath)
        });
        void this.options.receiptStore?.write(receipt);
        return receipt;
      },
      recordReceipt: async (receipt) => {
        await this.options.receiptStore?.write(receipt);
      }
    };
  }

  private require(path: CapabilityPath) {
    if (!this.supports(path)) {
      throw new UnsupportedCapabilityError(path);
    }
  }
}
