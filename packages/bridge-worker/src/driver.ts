import type { CapsuleAdapter, ReceiptStore } from "@capsule-sdk/core";
import type { Clock } from "./observe.js";
import type { Refusal } from "./validate.js";
import type { BridgeAction, BridgeRequest, CapabilityProfile } from "./wire.js";

// A driver maps one capability profile onto a Capsule adapter plus the few read-only provider calls
// the bridge needs around it (read a resource, find what an operation created). Every effect goes
// through the Capsule facade with the adapter the driver returns; the driver's reads change nothing.

/** What a read of one resource found. */
export interface ResourceState {
  exists: boolean;
  /** Provider-native state, for example "ready", "stopping", "running", "exited". */
  status?: string;
  /** Who created it, from the labels the worker put on it. */
  owner?: { job?: string; operation?: string };
}

/** Per-operation hooks the driver's adapter may use. */
export interface OperationHooks {
  /**
   * The operation this adapter acts for. A provider that labels its effects records this id on each,
   * the way the Docker profile labels a container with fabric.operation.
   */
  readonly operation: { readonly id: string; readonly key: string };
  /** Aborted when Fabric cancels this request and the profile allows cancel for the action. */
  cancel: AbortSignal;
  /** Reports that the action is running at the provider, so Fabric can record the locator early. */
  onRunning(state: string): void;
}

export interface BridgeDriver {
  readonly profile: CapabilityProfile;
  readonly clock: Clock;
  /** The scope this worker is bound to, keyed by the profile's scope_keys. */
  binding(): Promise<Record<string, string>>;
  /** A Capsule adapter for one operation. */
  adapter(hooks: OperationHooks): CapsuleAdapter;
  /** Where receipts go, and whether a written receipt can be referenced after this process ends. */
  receipts?: { store: ReceiptStore; durable: boolean };
  /**
   * Provider-specific refusals of a request the protocol accepts, for values this provider cannot
   * take safely (for example one that would read as a CLI option). Runs before any provider call.
   */
  admit?(request: BridgeRequest): Refusal | undefined;
  /** Reads a resource. Never changes provider state. */
  read(nativeId: string): Promise<ResourceState>;
  /** The resource an earlier create of this operation made, found by the profile's dedupe rule. */
  findCreated(operationId: string, key: string): Promise<string | undefined>;
  /** Whether `state` is the terminal state of `action`, and the native state to report if not. */
  terminal(action: BridgeAction, state: ResourceState): { terminal: true } | { terminal: false; state?: string };
  /** The provider name a create uses, derived from the operation so a retry cannot pick another. */
  resourceName(operationId: string, key: string): string;
  /** The value of a secret by name, resolved at the execution boundary. Never logged or sent back. */
  secret(name: string): string | undefined;
  /** Wall time for approval expiry. */
  now(): Date;
  /**
   * Called once when the session ends, before the worker exits. Stops local helper processes that
   * would otherwise outlive the worker. It must not cancel provider work: worker loss is not cancellation.
   */
  close?(): void;
}
