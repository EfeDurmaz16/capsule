import {
  ProviderValidationError,
  type AdapterContext,
  type AttachSandboxSpec,
  type CapsuleAdapter,
  type CapsuleReceipt,
  type CreateSandboxSpec,
  type ExecResult,
  type ExecSpec,
  type ReceiptStore,
  type Sandbox,
  type SandboxHandle
} from "@capsule-sdk/core";
import type { WorkerConfig } from "./config.js";
import type { BridgeDriver, OperationHooks, ResourceState } from "./driver.js";
import { BridgeUnknownError, virtualClock } from "./observe.js";
import { fixtureProfile } from "./profiles.js";
import { isPlainObject } from "./validate.js";
import type { BridgeAction } from "./wire.js";

// The deterministic, stateful fixture provider (draft P12 layer L1). It lives in memory, starts from
// a seed (a scenario's provider_state), and records every mutating call in `effects`, so a test can
// prove that a refused request reached no provider. Reads, cancels and settles are not effects.
// Native ids are fx-<operation key>, so the provider deduplicates creates on the key.

export interface FixtureSandboxState {
  native_id: string;
  account: string;
  project: string;
  owner_job?: string;
  operation?: string;
  status: "ready" | "stopping" | "destroyed";
}

export interface FixtureEffect {
  call: "create" | "exec" | "destroy";
  native_id: string;
}

export type FixtureBehavior = "fail" | "apply_then_lose_reply" | "fail_receipt" | "run_until_cancelled" | "stay_stopping_until_settle";

const behaviors: readonly FixtureBehavior[] = ["fail", "apply_then_lose_reply", "fail_receipt", "run_until_cancelled", "stay_stopping_until_settle"];

export interface FixtureSeed {
  sandboxes?: unknown[];
  script?: unknown[];
}

/** Thrown by the fixture's exec when Fabric cancels it; the worker answers a `cancelled` result. */
export class ExecCancelledError extends Error {
  constructor() {
    super("exec cancelled at the provider");
    this.name = "ExecCancelledError";
  }
}

export class FixtureProvider {
  /** Every mutating provider call, in order. Its length is what scenarios call provider_calls. */
  readonly effects: FixtureEffect[] = [];
  /** Exec cancellations the provider received. Not effects: a cancel never destroys anything. */
  readonly cancels: string[] = [];
  readonly receipts: FixtureReceiptStore;
  private readonly sandboxes = new Map<string, FixtureSandboxState>();
  private readonly script = new Map<string, FixtureBehavior>();

  constructor(
    readonly binding: { account: string; project: string },
    seed: FixtureSeed = {}
  ) {
    for (const [index, entry] of (seed.sandboxes ?? []).entries()) {
      if (!isPlainObject(entry) || typeof entry.native_id !== "string" || typeof entry.project !== "string") {
        throw new Error(`fixture sandboxes[${index}] needs native_id and project`);
      }
      const status = entry.status ?? "ready";
      if (status !== "ready" && status !== "stopping") throw new Error(`fixture sandboxes[${index}].status must be ready or stopping`);
      this.sandboxes.set(entry.native_id, {
        native_id: entry.native_id,
        account: typeof entry.account === "string" ? entry.account : binding.account,
        project: entry.project,
        ...(typeof entry.owner_job === "string" ? { owner_job: entry.owner_job } : {}),
        status
      });
    }
    for (const [index, entry] of (seed.script ?? []).entries()) {
      if (!isPlainObject(entry) || typeof entry.action !== "string" || typeof entry.native_id !== "string") {
        throw new Error(`fixture script[${index}] needs action and native_id`);
      }
      if (!behaviors.includes(entry.behavior as FixtureBehavior)) throw new Error(`fixture script[${index}] has an unknown behavior`);
      this.script.set(`${entry.action} ${entry.native_id}`, entry.behavior as FixtureBehavior);
    }
    this.receipts = new FixtureReceiptStore((receipt) => {
      const id = receipt.resource?.id;
      return id !== undefined && this.behavior("sandbox.create", id) === "fail_receipt";
    });
  }

  get providerCalls(): number {
    return this.effects.length;
  }

  sandbox(nativeId: string): Readonly<FixtureSandboxState> | undefined {
    return this.sandboxes.get(nativeId);
  }

  /** Scripted transitional states become terminal. */
  settle(): void {
    for (const sandbox of this.sandboxes.values()) {
      if (sandbox.status === "stopping") sandbox.status = "destroyed";
    }
  }

  behavior(action: BridgeAction, nativeId: string): FixtureBehavior | undefined {
    return this.script.get(`${action} ${nativeId}`);
  }

  create(nativeId: string, labels: Record<string, string>): void {
    this.effects.push({ call: "create", native_id: nativeId });
    const behavior = this.behavior("sandbox.create", nativeId);
    if (behavior === "fail") {
      throw new ProviderValidationError("fixture provider refused the create", { category: "validation", retryable: false, code: "refused" });
    }
    const existing = this.sandboxes.get(nativeId);
    if (!existing || existing.status === "destroyed") {
      this.sandboxes.set(nativeId, {
        native_id: nativeId,
        account: this.binding.account,
        project: this.binding.project,
        ...(labels["fabric.job"] ? { owner_job: labels["fabric.job"] } : {}),
        ...(labels["fabric.operation"] ? { operation: labels["fabric.operation"] } : {}),
        status: "ready"
      });
    }
  }

  destroy(nativeId: string): void {
    this.effects.push({ call: "destroy", native_id: nativeId });
    const sandbox = this.sandboxes.get(nativeId);
    if (!sandbox) throw new ProviderValidationError(`fixture sandbox ${nativeId} not found`, { category: "validation", retryable: false, code: "not_found" });
    sandbox.status = this.behavior("sandbox.destroy", nativeId) === "stay_stopping_until_settle" ? "stopping" : "destroyed";
  }

  async exec(nativeId: string, spec: ExecSpec, hooks: OperationHooks): Promise<ExecResult> {
    this.effects.push({ call: "exec", native_id: nativeId });
    if (this.behavior("sandbox.exec", nativeId) === "run_until_cancelled") {
      hooks.onRunning("running");
      await new Promise<void>((resolve) => {
        if (hooks.cancel.aborted) return resolve();
        hooks.cancel.addEventListener("abort", () => resolve(), { once: true });
      });
      this.cancels.push(nativeId);
      throw new ExecCancelledError();
    }
    const argv = Array.isArray(spec.command) ? spec.command : [spec.command];
    const [program, ...args] = argv;
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    switch (program) {
      case "echo":
        stdout = `${args.join(" ")}\n`;
        break;
      case "cat":
        stdout = spec.input ?? "";
        break;
      case "true":
        break;
      case "false":
        exitCode = 1;
        break;
      case "fail":
        exitCode = Number.parseInt(args[0] ?? "1", 10) || 1;
        stderr = args[1] === undefined ? "" : `${args[1]}\n`;
        break;
      default:
        exitCode = 127;
        stderr = `${program}: not found\n`;
    }
    const maxBytes = spec.bounds?.maxBytes ?? Number.POSITIVE_INFINITY;
    const out = capture(stdout, maxBytes);
    const err = capture(stderr, maxBytes);
    return { exitCode, stdout: out.text, stderr: err.text, logs: [], artifacts: [], truncation: { stdout: out.truncation, stderr: err.truncation } };
  }
}

function capture(
  text: string,
  maxBytes: number
): { text: string; truncation: { truncated: boolean; capturedBytes: number; reason?: "bytes"; limit?: number } } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return { text, truncation: { truncated: false, capturedBytes: bytes.byteLength } };
  const kept = bytes.subarray(0, maxBytes);
  return { text: kept.toString("utf8"), truncation: { truncated: true, capturedBytes: kept.byteLength, reason: "bytes", limit: maxBytes } };
}

/**
 * The fixture's receipt store: keeps the most recent receipts in memory, counts all of them, and
 * refuses the scripted ones. Bounded, so a long-lived fixture worker does not grow without limit.
 */
export class FixtureReceiptStore implements ReceiptStore {
  readonly receipts: CapsuleReceipt[] = [];
  written = 0;

  constructor(
    private readonly refuses: (receipt: CapsuleReceipt) => boolean,
    private readonly keep = 256
  ) {}

  write(receipt: CapsuleReceipt): void {
    if (this.refuses(receipt)) throw new Error("receipt store refused the write");
    this.written += 1;
    this.receipts.push(receipt);
    if (this.receipts.length > this.keep) this.receipts.shift();
  }
}

const capabilities = {
  sandbox: { create: "native", exec: "native", fileRead: "unsupported", fileWrite: "unsupported", fileList: "unsupported", destroy: "native" }
} as const;

class FixtureSandbox implements Sandbox {
  constructor(
    readonly handle: SandboxHandle,
    private readonly provider: FixtureProvider,
    private readonly hooks: OperationHooks
  ) {}

  exec(spec: ExecSpec): Promise<ExecResult> {
    return this.provider.exec(this.handle.id, spec, this.hooks);
  }

  async writeFile(): Promise<void> {
    throw new ProviderValidationError("the fixture provider has no files", { category: "validation", retryable: false });
  }

  async readFile(): Promise<Uint8Array> {
    throw new ProviderValidationError("the fixture provider has no files", { category: "validation", retryable: false });
  }

  async listFiles(): Promise<never[]> {
    throw new ProviderValidationError("the fixture provider has no files", { category: "validation", retryable: false });
  }

  async destroy(): Promise<void> {
    this.provider.destroy(this.handle.id);
  }
}

/** The fixture provider as a Capsule adapter, for one operation. */
export function fixtureAdapter(provider: FixtureProvider, hooks: OperationHooks): CapsuleAdapter {
  const handle = (id: string): SandboxHandle => ({ id, provider: "fixture", createdAt: "1970-01-01T00:00:00.000Z" });
  return {
    name: "fixture",
    provider: "fixture",
    capabilities,
    sandbox: {
      create: async (spec: CreateSandboxSpec, context: AdapterContext): Promise<Sandbox> => {
        const nativeId = `fx-${spec.idempotencyKey ?? spec.name ?? "anonymous"}`;
        const startedAt = new Date(0);
        provider.create(nativeId, spec.labels ?? {});
        if (provider.behavior("sandbox.create", nativeId) === "apply_then_lose_reply") {
          throw new BridgeUnknownError("reply_lost", {
            operation: "sandbox.create",
            resource: { provider: "fixture", kind: "sandbox", nativeId, scope: { ...provider.binding } }
          });
        }
        if (context.receipts) {
          context.createReceipt({
            type: "sandbox.create",
            capabilityPath: "sandbox.create",
            startedAt,
            finishedAt: startedAt,
            ...(spec.image ? { image: spec.image } : {}),
            policy: context.evaluatePolicy({ env: spec.env }),
            resource: { id: nativeId, status: "ready" }
          });
        }
        return new FixtureSandbox(handle(nativeId), provider, hooks);
      },
      attach: async (spec: AttachSandboxSpec): Promise<Sandbox> => {
        if (!provider.sandbox(spec.id)) {
          throw new ProviderValidationError(`fixture sandbox ${spec.id} not found`, { category: "validation", retryable: false, code: "not_found" });
        }
        return new FixtureSandbox(handle(spec.id), provider, hooks);
      }
    }
  };
}

/** The fixture profile's driver over one FixtureProvider. */
export function fixtureDriver(provider: FixtureProvider): BridgeDriver {
  return {
    profile: fixtureProfile,
    clock: virtualClock,
    binding: async () => ({ ...provider.binding }),
    adapter: (hooks) => fixtureAdapter(provider, hooks),
    receipts: { store: provider.receipts, durable: false },
    read: async (nativeId): Promise<ResourceState> => {
      const sandbox = provider.sandbox(nativeId);
      if (!sandbox || sandbox.account !== provider.binding.account || sandbox.project !== provider.binding.project) return { exists: false };
      return {
        exists: true,
        status: sandbox.status,
        owner: { ...(sandbox.owner_job ? { job: sandbox.owner_job } : {}), ...(sandbox.operation ? { operation: sandbox.operation } : {}) }
      };
    },
    findCreated: async (_operationId, key) => {
      const sandbox = provider.sandbox(`fx-${key}`);
      return sandbox && sandbox.status !== "destroyed" ? sandbox.native_id : undefined;
    },
    terminal: (action, state) => {
      if (action === "sandbox.destroy") {
        return !state.exists || state.status === "destroyed" ? { terminal: true } : { terminal: false, ...(state.status ? { state: state.status } : {}) };
      }
      return state.exists && state.status === "ready" ? { terminal: true } : { terminal: false, ...(state.status ? { state: state.status } : {}) };
    },
    resourceName: (_operationId, key) => `fx-${key}`,
    secret: (name) => `fixture-secret-${name}`,
    now: () => new Date()
  };
}

/** Builds a fixture provider from a worker config that carries a fixture seed. */
export function fixtureProviderFromConfig(config: WorkerConfig): FixtureProvider {
  const binding = config.binding;
  if (!binding || typeof binding.account !== "string" || typeof binding.project !== "string") {
    throw new Error("the fixture profile needs binding.account and binding.project");
  }
  return new FixtureProvider({ account: binding.account, project: binding.project }, { sandboxes: config.sandboxes ?? [], script: config.script ?? [] });
}
