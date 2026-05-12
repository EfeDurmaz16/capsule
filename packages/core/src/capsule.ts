import { UnsupportedCapabilityError } from "./errors.js";
import { supportLevel, supports, type CapabilityPath } from "./capabilities.js";
import { evaluatePolicy, mergeTimeout } from "./policy.js";
import { createReceipt } from "./receipts.js";
import type { AdapterContext, CapsuleAdapter } from "./adapters.js";
import type {
  CapabilityMap,
  CapsulePolicy,
  CreateDatabaseBranchSpec,
  CreateMachineSpec,
  CreatePreviewSpec,
  CreateSandboxSpec,
  DeployEdgeSpec,
  DeployServiceSpec,
  RunJobSpec
} from "./types.js";

export interface CapsuleOptions {
  adapter: CapsuleAdapter;
  policy?: CapsulePolicy;
  receipts?: boolean;
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
        }
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
      createReceipt: (input) =>
        createReceipt({
          ...input,
          provider: adapter.provider,
          adapter: adapter.name,
          supportLevel: input.supportLevel ?? supportLevel(adapter.capabilities, input.capabilityPath as CapabilityPath)
        })
    };
  }

  private require(path: CapabilityPath) {
    if (!this.supports(path)) {
      throw new UnsupportedCapabilityError(path);
    }
  }
}
