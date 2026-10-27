import { AsyncLocalStorage } from "node:async_hooks";
import { UnsupportedCapabilityError } from "./errors.js";
import { explainSupportLevel, supportLevel, supports, type CapabilityPath } from "./capabilities.js";
import { evaluatePolicy, mergeTimeout, redactError, type PolicyInput } from "./policy.js";
import { createReceipt } from "./receipts.js";
import { capsuleOperationTag } from "./idempotency.js";
import type { AdapterContext, CapsuleAdapter } from "./adapters.js";
import type { ReceiptPersistenceMode, ReceiptStore } from "./stores.js";
import type {
  AttachSandboxSpec,
  CapabilityMap,
  CapsuleReceipt,
  CancelJobSpec,
  CapsulePolicy,
  CapsuleApprovalResourceScope,
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
import type { ExecSpec, Sandbox, SandboxDestroyOptions } from "./types.js";

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
  idempotencyKey?: string;
  idempotencyScope?: string;
  receiptCounter?: { count: number };
  /**
   * Required receipt writes owned by exactly one operation. Each operation awaits only its own list,
   * and the list is dropped with the operation, so sibling operations never share completion waits.
   */
  pendingWrites?: Promise<void>[];
}

/**
 * One frame of the operation context: the Capsule that runs it, its options, and the frame it runs
 * inside. All Capsule instances share one AsyncLocalStorage and each instance reads the innermost frame
 * it owns, which is what a storage per instance gave. A storage per instance is never released on
 * Node 22 (async_hooks), and every live one is visited on every new async resource, so a process that
 * creates many Capsule instances slowed down linearly with their count.
 */
interface OperationFrame {
  owner: Capsule;
  options: ContextOptions;
  parent: OperationFrame | undefined;
}

const operationContext = new AsyncLocalStorage<OperationFrame>();

interface ContextRuntime {
  context: AdapterContext;
  defaultOptions: ContextOptions;
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
  throw new Error(
    `Adapter attempted to create receipt ${input.type}/${input.capabilityPath} outside active operation receipt scope. Expected one of: ${allowed}.`
  );
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
        const policyInput = {
          env: spec.env,
          timeoutMs: spec.timeoutMs,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("sandbox", { name: spec.name })
        };
        this.evaluateOperationPolicy("sandbox.create", policyInput);
        if (!this.options.adapter.sandbox) {
          throw new UnsupportedCapabilityError("sandbox.create");
        }
        const runtime = this.contextRuntime({ ...policyInput, receiptScopes: sandboxCreateReceiptScope });
        await this.preflightReceiptPersistence();
        let sandbox: Sandbox;
        try {
          sandbox = await this.runInContext(runtime.defaultOptions, () =>
            this.options.adapter.sandbox!.create({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, runtime.context)
          );
        } catch (error) {
          throw redactError(error, spec.env, this.options.policy);
        }
        if (this.receiptPersistenceMode() === "required") {
          await Promise.all(runtime.defaultOptions.pendingWrites ?? []);
        }
        // The create operation is finished: later sandbox operations own their own write lists.
        runtime.defaultOptions = { ...runtime.defaultOptions, pendingWrites: undefined };
        return this.wrapSandbox(sandbox, runtime, spec.approval);
      },
      /**
       * Wraps an existing sandbox so its operations are governed like those of a created one. It makes
       * no provider call that changes state, evaluates no policy and writes no receipt; each later
       * operation does. There is no captured create grant: exec and destroy need their own approval
       * where policy requires one.
       */
      attach: async (spec: AttachSandboxSpec) => {
        if (!this.options.adapter.sandbox?.attach) {
          throw new UnsupportedCapabilityError("sandbox.attach");
        }
        const runtime = this.contextRuntime({});
        let sandbox: Sandbox;
        try {
          sandbox = await this.options.adapter.sandbox.attach(spec, runtime.context);
        } catch (error) {
          throw redactError(error, undefined, this.options.policy);
        }
        runtime.defaultOptions = { ...runtime.defaultOptions, pendingWrites: undefined };
        return this.wrapSandbox(sandbox, runtime, undefined);
      }
    };

    this.job = {
      run: async (spec: RunJobSpec) => {
        this.require("job.run");
        const policyInput = {
          env: spec.env,
          timeoutMs: spec.timeoutMs,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("job", { name: spec.name })
        };
        this.evaluateOperationPolicy("job.run", policyInput);
        if (!this.options.adapter.job) {
          throw new UnsupportedCapabilityError("job.run");
        }
        return this.withContext(
          (context) => this.options.adapter.job!.run({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, context),
          {
            ...policyInput,
            receiptScopes: receiptScope("job.run", "job.run")
          }
        );
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
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("job", { id: spec.id }) };
        this.evaluateOperationPolicy("job.cancel", policyInput);
        if (!this.options.adapter.job?.cancel) {
          throw new UnsupportedCapabilityError("job.cancel");
        }
        return this.withContext((context) => this.options.adapter.job!.cancel!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("job.cancel", "job.cancel")
        });
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
        const policyInput = {
          env: spec.env,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("service", { name: spec.name })
        };
        this.evaluateOperationPolicy("service.deploy", policyInput);
        if (!this.options.adapter.service) {
          throw new UnsupportedCapabilityError("service.deploy");
        }
        return this.withContext((context) => this.options.adapter.service!.deploy(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("service.deploy", "service.deploy")
        });
      },
      status: async (spec: ServiceStatusSpec) => {
        this.require("service.status");
        if (!this.options.adapter.service?.status) {
          throw new UnsupportedCapabilityError("service.status");
        }
        return this.withContext((context) => this.options.adapter.service!.status!(spec, context), {
          receiptScopes: receiptScope("service.status", "service.status")
        });
      },
      update: async (spec: UpdateServiceSpec) => {
        this.require("service.update");
        const policyInput = {
          env: spec.env,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("service", { id: spec.id })
        };
        this.evaluateOperationPolicy("service.update", policyInput);
        if (!this.options.adapter.service?.update) {
          throw new UnsupportedCapabilityError("service.update");
        }
        return this.withContext((context) => this.options.adapter.service!.update!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("service.update", "service.update")
        });
      },
      rollback: async (spec: RollbackServiceSpec) => {
        this.require("service.rollback");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("service", { id: spec.id }) };
        this.evaluateOperationPolicy("service.rollback", policyInput);
        if (!this.options.adapter.service?.rollback) {
          throw new UnsupportedCapabilityError("service.rollback");
        }
        return this.withContext((context) => this.options.adapter.service!.rollback!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("service.rollback", "service.rollback")
        });
      },
      delete: async (spec: DeleteServiceSpec) => {
        this.require("service.delete");
        // The provider is part of the hint so a grant scoped to one provider's resource does not match a
        // same-id resource on another provider. A grant without provider still matches as before.
        const policyInput = {
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("service", { id: spec.id, provider: this.options.adapter.provider })
        };
        this.evaluateOperationPolicy("service.delete", policyInput);
        if (!this.options.adapter.service?.delete) {
          throw new UnsupportedCapabilityError("service.delete");
        }
        return this.withContext((context) => this.options.adapter.service!.delete!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("service.delete", "service.delete")
        });
      },
      logs: async (spec: ServiceLogsSpec) => {
        this.require("service.logs");
        if (!this.options.adapter.service?.logs) {
          throw new UnsupportedCapabilityError("service.logs");
        }
        return this.withContext((context) => this.options.adapter.service!.logs!(spec, context), {
          receiptScopes: receiptScope("service.logs", "service.logs")
        });
      }
    };

    this.edge = {
      deploy: async (spec: DeployEdgeSpec) => {
        this.require("edge.deploy");
        const policyInput = {
          env: spec.env,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("edge", { name: spec.name })
        };
        this.evaluateOperationPolicy("edge.deploy", policyInput);
        if (!this.options.adapter.edge) {
          throw new UnsupportedCapabilityError("edge.deploy");
        }
        return this.withContext((context) => this.options.adapter.edge!.deploy(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("edge.deploy", "edge.deploy")
        });
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
        const policyInput = {
          env: spec.env,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("edge", { id: spec.deploymentId, name: spec.name })
        };
        this.evaluateOperationPolicy("edge.version", policyInput);
        if (!this.options.adapter.edge?.version) {
          throw new UnsupportedCapabilityError("edge.version");
        }
        return this.withContext((context) => this.options.adapter.edge!.version!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("edge.version", "edge.version")
        });
      },
      release: async (spec: ReleaseEdgeVersionSpec) => {
        this.require("edge.release");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("edge", { id: spec.versionId }) };
        this.evaluateOperationPolicy("edge.release", policyInput);
        if (!this.options.adapter.edge?.release) {
          throw new UnsupportedCapabilityError("edge.release");
        }
        return this.withContext((context) => this.options.adapter.edge!.release!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("edge.release", "edge.release")
        });
      },
      rollback: async (spec: RollbackEdgeSpec) => {
        this.require("edge.rollback");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("edge", { id: spec.deploymentId }) };
        this.evaluateOperationPolicy("edge.rollback", policyInput);
        if (!this.options.adapter.edge?.rollback) {
          throw new UnsupportedCapabilityError("edge.rollback");
        }
        return this.withContext((context) => this.options.adapter.edge!.rollback!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("edge.rollback", "edge.rollback")
        });
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
          const policyInput = {
            ttlMs: spec.ttlMs,
            approval: spec.approval,
            idempotencyKey: spec.idempotencyKey,
            resource: approvalResource("database", { project: spec.project, name: spec.name })
          };
          this.evaluateOperationPolicy("database.branchCreate", policyInput);
          if (!this.options.adapter.database) {
            throw new UnsupportedCapabilityError("database.branchCreate");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.create(spec, context), {
            ...policyInput,
            receiptScopes: receiptScope("database.branch.create", "database.branchCreate")
          });
        },
        delete: async (spec: DeleteDatabaseBranchSpec) => {
          this.require("database.branchDelete");
          const policyInput = {
            approval: spec.approval,
            idempotencyKey: spec.idempotencyKey,
            resource: approvalResource("database", { project: spec.project, id: spec.branchId, provider: this.options.adapter.provider })
          };
          this.evaluateOperationPolicy("database.branchDelete", policyInput);
          if (!this.options.adapter.database?.branch.delete) {
            throw new UnsupportedCapabilityError("database.branchDelete");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.delete!(spec, context), {
            ...policyInput,
            receiptScopes: receiptScope("database.branch.delete", "database.branchDelete")
          });
        },
        reset: async (spec: ResetDatabaseBranchSpec) => {
          this.require("database.branchReset");
          const policyInput = {
            approval: spec.approval,
            idempotencyKey: spec.idempotencyKey,
            resource: approvalResource("database", { project: spec.project, id: spec.branchId })
          };
          this.evaluateOperationPolicy("database.branchReset", policyInput);
          if (!this.options.adapter.database?.branch.reset) {
            throw new UnsupportedCapabilityError("database.branchReset");
          }
          return this.withContext((context) => this.options.adapter.database!.branch.reset!(spec, context), {
            ...policyInput,
            receiptScopes: receiptScope("database.branch.reset", "database.branchReset")
          });
        }
      },
      migrate: async (spec: MigrateDatabaseSpec) => {
        this.require("database.migrate");
        const policyInput = {
          env: spec.env,
          timeoutMs: spec.timeoutMs,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("database", { project: spec.project, id: spec.branchId })
        };
        this.evaluateOperationPolicy("database.migrate", policyInput);
        if (!this.options.adapter.database?.migrate) {
          throw new UnsupportedCapabilityError("database.migrate");
        }
        return this.withContext(
          (context) => this.options.adapter.database!.migrate!({ ...spec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) }, context),
          {
            ...policyInput,
            receiptScopes: receiptScope("database.migrate", "database.migrate")
          }
        );
      }
    };

    this.preview = {
      create: async (spec: CreatePreviewSpec) => {
        this.require("preview.create");
        const policyInput = {
          ttlMs: spec.ttlMs,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("preview", { name: spec.name })
        };
        this.evaluateOperationPolicy("preview.create", policyInput);
        if (!this.options.adapter.preview) {
          throw new UnsupportedCapabilityError("preview.create");
        }
        return this.withContext((context) => this.options.adapter.preview!.create(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("preview.create", "preview.create")
        });
      },
      destroy: async (spec: DestroyPreviewSpec) => {
        this.require("preview.destroy");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("preview", { id: spec.id }) };
        this.evaluateOperationPolicy("preview.destroy", policyInput);
        if (!this.options.adapter.preview?.destroy) {
          throw new UnsupportedCapabilityError("preview.destroy");
        }
        return this.withContext((context) => this.options.adapter.preview!.destroy!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("preview.destroy", "preview.destroy")
        });
      },
      status: async (spec: PreviewStatusSpec) => {
        this.require("preview.status");
        if (!this.options.adapter.preview?.status) {
          throw new UnsupportedCapabilityError("preview.status");
        }
        return this.withContext((context) => this.options.adapter.preview!.status!(spec, context), {
          receiptScopes: receiptScope("preview.status", "preview.status")
        });
      },
      logs: async (spec: PreviewLogsSpec) => {
        this.require("preview.logs");
        if (!this.options.adapter.preview?.logs) {
          throw new UnsupportedCapabilityError("preview.logs");
        }
        return this.withContext((context) => this.options.adapter.preview!.logs!(spec, context), {
          receiptScopes: receiptScope("preview.logs", "preview.logs")
        });
      },
      urls: async (spec: PreviewUrlsSpec) => {
        this.require("preview.urls");
        if (!this.options.adapter.preview?.urls) {
          throw new UnsupportedCapabilityError("preview.urls");
        }
        return this.withContext((context) => this.options.adapter.preview!.urls!(spec, context), {
          receiptScopes: receiptScope("preview.urls", "preview.urls")
        });
      },
      cleanup: async (spec: CleanupPreviewSpec) => {
        this.require("preview.cleanup");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("preview", { id: spec.id }) };
        this.evaluateOperationPolicy("preview.cleanup", policyInput);
        if (!this.options.adapter.preview?.cleanup) {
          throw new UnsupportedCapabilityError("preview.cleanup");
        }
        return this.withContext((context) => this.options.adapter.preview!.cleanup!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("preview.cleanup", "preview.cleanup")
        });
      }
    };

    this.machine = {
      create: async (spec: CreateMachineSpec) => {
        this.require("machine.create");
        const policyInput = {
          env: spec.env,
          approval: spec.approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("machine", { name: spec.name })
        };
        this.evaluateOperationPolicy("machine.create", policyInput);
        if (!this.options.adapter.machine) {
          throw new UnsupportedCapabilityError("machine.create");
        }
        return this.withContext((context) => this.options.adapter.machine!.create(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("machine.create", "machine.create")
        });
      },
      status: async (spec: MachineStatusSpec) => {
        this.require("machine.status");
        if (!this.options.adapter.machine?.status) {
          throw new UnsupportedCapabilityError("machine.status");
        }
        return this.withContext((context) => this.options.adapter.machine!.status!(spec, context), {
          receiptScopes: receiptScope("machine.status", "machine.status")
        });
      },
      start: async (spec: StartMachineSpec) => {
        this.require("machine.start");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("machine", { id: spec.id }) };
        this.evaluateOperationPolicy("machine.start", policyInput);
        if (!this.options.adapter.machine?.start) {
          throw new UnsupportedCapabilityError("machine.start");
        }
        return this.withContext((context) => this.options.adapter.machine!.start!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("machine.start", "machine.start")
        });
      },
      stop: async (spec: StopMachineSpec) => {
        this.require("machine.stop");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("machine", { id: spec.id }) };
        this.evaluateOperationPolicy("machine.stop", policyInput);
        if (!this.options.adapter.machine?.stop) {
          throw new UnsupportedCapabilityError("machine.stop");
        }
        return this.withContext((context) => this.options.adapter.machine!.stop!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("machine.stop", "machine.stop")
        });
      },
      destroy: async (spec: DestroyMachineSpec) => {
        this.require("machine.destroy");
        const policyInput = { approval: spec.approval, idempotencyKey: spec.idempotencyKey, resource: approvalResource("machine", { id: spec.id }) };
        this.evaluateOperationPolicy("machine.destroy", policyInput);
        if (!this.options.adapter.machine?.destroy) {
          throw new UnsupportedCapabilityError("machine.destroy");
        }
        return this.withContext((context) => this.options.adapter.machine!.destroy!(spec, context), {
          ...policyInput,
          receiptScopes: receiptScope("machine.destroy", "machine.destroy")
        });
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

  private runInContext<T>(options: ContextOptions, fn: () => T): T {
    return operationContext.run({ owner: this, options, parent: operationContext.getStore() }, fn);
  }

  /** The options of the innermost operation this instance is running, if any. */
  private currentContext(): ContextOptions | undefined {
    for (let frame = operationContext.getStore(); frame; frame = frame.parent) {
      if (frame.owner === this) return frame.options;
    }
    return undefined;
  }

  private async withContext<T>(operation: (context: AdapterContext) => Promise<T>, options: ContextOptions = {}): Promise<T> {
    const runtime = this.contextRuntime(options);
    await this.preflightReceiptPersistence();
    let result: T;
    try {
      result = await this.runInContext(runtime.defaultOptions, () => operation(runtime.context));
    } catch (error) {
      throw redactError(error, options.env, this.options.policy);
    }
    if (this.receiptPersistenceMode() === "required") {
      await Promise.all(runtime.defaultOptions.pendingWrites ?? []);
    }
    return result;
  }

  private evaluateOperationPolicy(path: CapabilityPath, input: Omit<PolicyInput, "capabilityPath"> = {}) {
    return evaluatePolicy(this.options.policy, {
      ...input,
      capabilityPath: path,
      supportLevel: input.supportLevel ?? supportLevel(this.options.adapter.capabilities, path),
      networkPolicySupport: input.networkPolicySupport ?? this.options.adapter.capabilities.sandbox?.networkPolicy
    });
  }

  private contextRuntime(defaultOptions: ContextOptions): ContextRuntime {
    const capabilityPath = defaultOptions.capabilityPath ?? defaultCapabilityPath(defaultOptions.receiptScopes);
    const normalizedOptions: ContextOptions = {
      ...defaultOptions,
      capabilityPath,
      supportLevel:
        defaultOptions.supportLevel ?? (capabilityPath ? supportLevel(this.options.adapter.capabilities, capabilityPath as CapabilityPath) : undefined),
      idempotencyScope: defaultOptions.idempotencyScope ?? (defaultOptions.idempotencyKey ? capabilityPath : undefined),
      pendingWrites: []
    };
    const runtime: ContextRuntime = {
      context: undefined as unknown as AdapterContext,
      defaultOptions: normalizedOptions
    };
    runtime.context = this.context(runtime);
    return runtime;
  }

  private async withSandboxSubOperation<T>(options: ContextOptions, operation: () => Promise<T>): Promise<T> {
    await this.preflightReceiptPersistence();
    const pendingWrites: Promise<void>[] = [];
    let result: T;
    try {
      result = await this.runInContext({ ...options, pendingWrites }, operation);
    } catch (error) {
      throw redactError(error, options.env, this.options.policy);
    }
    if (this.receiptPersistenceMode() === "required") {
      await Promise.all(pendingWrites);
    }
    return result;
  }

  private wrapSandbox(sandbox: Sandbox, runtime: ContextRuntime, approval: PolicyInput["approval"]): Sandbox {
    return {
      handle: sandbox.handle,
      exec: async (spec: ExecSpec) => {
        this.require("sandbox.exec");
        const startedAt = new Date();
        const policyInput = {
          env: spec.env,
          timeoutMs: spec.timeoutMs,
          // A fresh per-exec grant replaces the captured create grant for this operation only.
          approval: spec.approval ?? approval,
          idempotencyKey: spec.idempotencyKey,
          resource: approvalResource("sandbox", { id: sandbox.handle.id, provider: sandbox.handle.provider })
        };
        const policy = this.evaluateOperationPolicy("sandbox.exec", policyInput);
        const emitted = { count: 0 };
        const { approval: _freshApproval, ...adapterSpec } = spec;
        return this.withSandboxSubOperation({ ...policyInput, receiptScopes: sandboxExecReceiptScope, receiptCounter: emitted }, async () => {
          const result = await sandbox.exec({ ...adapterSpec, timeoutMs: mergeTimeout(this.options.policy, spec.timeoutMs) });
          if ((this.options.receipts ?? false) && emitted.count === 0) {
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
        const policyInput = { approval, resource: approvalResource("sandbox", { id: sandbox.handle.id, provider: sandbox.handle.provider, path }) };
        const policy = this.evaluateOperationPolicy("sandbox.fileWrite", policyInput);
        const emitted = { count: 0 };
        await this.withSandboxSubOperation({ ...policyInput, receiptScopes: sandboxFileWriteReceiptScope, receiptCounter: emitted }, async () => {
          await sandbox.writeFile(path, data);
          if ((this.options.receipts ?? false) && emitted.count === 0) {
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
        const policyInput = { approval, resource: approvalResource("sandbox", { id: sandbox.handle.id, provider: sandbox.handle.provider, path }) };
        const policy = this.evaluateOperationPolicy("sandbox.fileRead", policyInput);
        const emitted = { count: 0 };
        return this.withSandboxSubOperation({ ...policyInput, receiptScopes: sandboxFileReadReceiptScope, receiptCounter: emitted }, async () => {
          const data = await sandbox.readFile(path);
          if ((this.options.receipts ?? false) && emitted.count === 0) {
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
        const policyInput = { approval, resource: approvalResource("sandbox", { id: sandbox.handle.id, provider: sandbox.handle.provider, path }) };
        const policy = this.evaluateOperationPolicy("sandbox.fileList", policyInput);
        const emitted = { count: 0 };
        return this.withSandboxSubOperation({ ...policyInput, receiptScopes: sandboxFileListReceiptScope, receiptCounter: emitted }, async () => {
          const entries = await sandbox.listFiles(path);
          if ((this.options.receipts ?? false) && emitted.count === 0) {
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
      destroy: async (options?: SandboxDestroyOptions) => {
        this.require("sandbox.destroy");
        const startedAt = new Date();
        // A fresh destroy grant replaces the captured create grant; both are validated for sandbox.destroy.
        const policyInput = {
          approval: options?.approval ?? approval,
          resource: approvalResource("sandbox", { id: sandbox.handle.id, provider: sandbox.handle.provider })
        };
        const policy = this.evaluateOperationPolicy("sandbox.destroy", policyInput);
        const emitted = { count: 0 };
        await this.withSandboxSubOperation({ ...policyInput, receiptScopes: sandboxDestroyReceiptScope, receiptCounter: emitted }, async () => {
          await sandbox.destroy();
          if ((this.options.receipts ?? false) && emitted.count === 0) {
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

  private persistReceipt(receipt: CapsuleReceipt, pendingWrites: Promise<void>[] | undefined): Promise<void> {
    const mode = this.receiptPersistenceMode();
    if (!this.options.receiptStore) {
      if (mode === "best-effort") {
        return Promise.resolve();
      }
      const missingStore = Promise.reject(new Error("Receipt persistence is required but no receiptStore is configured."));
      pendingWrites?.push(missingStore);
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
      pendingWrites?.push(write);
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
        const options = this.currentContext() ?? runtime.defaultOptions;
        // Sandbox sub-operations carry their capability through the receipt scope, so adapter-side checks
        // validate a capability-scoped (fresh or captured) grant against the operation actually running.
        const capabilityPath = input.capabilityPath ?? options.capabilityPath ?? defaultCapabilityPath(options.receiptScopes);
        return evaluatePolicy(this.options.policy, {
          ...input,
          approval: input.approval ?? options.approval,
          capabilityPath,
          supportLevel:
            input.supportLevel ?? options.supportLevel ?? (capabilityPath ? supportLevel(adapter.capabilities, capabilityPath as CapabilityPath) : undefined),
          networkPolicySupport: input.networkPolicySupport ?? adapter.capabilities.sandbox?.networkPolicy,
          resource: input.resource ?? options.resource
        });
      },
      createReceipt: (input) => {
        const options = this.currentContext() ?? runtime.defaultOptions;
        assertReceiptScope(input, options.receiptScopes);
        const receipt = createReceipt(
          {
            ...input,
            metadata: withOperationReceiptMetadata(input.metadata, options),
            provider: adapter.provider,
            adapter: adapter.name,
            supportLevel: input.supportLevel ?? supportLevel(adapter.capabilities, input.capabilityPath as CapabilityPath)
          },
          this.options.receiptSigner
        );
        if (options.receiptCounter) {
          options.receiptCounter.count += 1;
        }
        void this.persistReceipt(receipt, options.pendingWrites);
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

function defaultCapabilityPath(scopes: ReceiptScope | readonly ReceiptScope[] | undefined): CapabilityPath | undefined {
  const normalized = normalizeReceiptScopes(scopes);
  return normalized.length === 1 ? normalized[0]?.capabilityPath : undefined;
}

function approvalResource(type: string, fields: Omit<CapsuleApprovalResourceScope, "type">): CapsuleApprovalResourceScope {
  return Object.fromEntries(Object.entries({ type, ...fields }).filter((entry) => entry[1] !== undefined)) as CapsuleApprovalResourceScope;
}

function withOperationReceiptMetadata(metadata: CapsuleReceipt["metadata"] | undefined, options: ContextOptions): CapsuleReceipt["metadata"] | undefined {
  if (!options.idempotencyKey) {
    return metadata;
  }
  return {
    ...metadata,
    idempotencyKey: options.idempotencyKey,
    idempotencyScope: options.idempotencyScope ?? options.capabilityPath,
    operationTag: capsuleOperationTag({
      idempotencyKey: options.idempotencyKey,
      idempotencyScope: options.idempotencyScope,
      capabilityPath: options.capabilityPath ?? "operation"
    })
  };
}
