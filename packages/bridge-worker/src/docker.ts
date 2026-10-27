import type { ReceiptStore } from "@capsule-sdk/core";
import { docker, dockerAvailable, runDocker, type DockerCommandResult, type RunDockerOptions } from "@capsule-sdk/docker";
import type { BridgeDriver, ResourceState } from "./driver.js";
import { wallClock } from "./observe.js";
import { dockerProfile } from "./profiles.js";

// The local Docker profile (draft P12 layer L3). Effects go through Capsule's Docker adapter with
// pull: never, so a create never reaches a registry. The bridge's reads are `docker inspect` and a
// label query; neither changes anything. Containers carry fabric.operation, fabric.job,
// fabric.attempt and fabric.generation labels, which is how a later request proves ownership and how
// a create of the same operation after a worker restart finds the container instead of making another.

type DockerRunner = (args: string[], options?: RunDockerOptions) => Promise<DockerCommandResult>;

export interface DockerDriverOptions {
  /** The engine scope. Omitted: the docker CLI's current context, read once at the first request. */
  binding?: { engine: string };
  runner?: DockerRunner;
  checkAvailable?: () => Promise<boolean>;
  receipts?: { store: ReceiptStore; durable: boolean };
  /**
   * Resolves a secret value by name at the execution boundary. Defaults to no secrets at all: the
   * worker's own environment is never a source unless the caller scopes it to named secrets.
   */
  secret?: (name: string) => string | undefined;
}

interface InspectedState {
  Status?: string;
  Running?: boolean;
}

export function dockerDriver(options: DockerDriverOptions = {}): BridgeDriver {
  const runner = options.runner ?? runDocker;
  const adapter = docker({ runner, checkAvailable: options.checkAvailable ?? dockerAvailable, pull: "never" });
  let binding: Promise<Record<string, string>> | undefined;
  return {
    profile: dockerProfile,
    clock: wallClock,
    binding: () => {
      if (options.binding) return Promise.resolve({ ...options.binding });
      binding ??= runner(["context", "show"], { timeoutMs: 10_000 }).then((shown) => {
        if (shown.exitCode !== 0 || shown.stdout.trim() === "") throw new Error("docker context show failed");
        return { engine: shown.stdout.trim() };
      });
      binding.catch(() => {
        binding = undefined;
      });
      return binding;
    },
    adapter: () => adapter,
    ...(options.receipts ? { receipts: options.receipts } : {}),
    read: async (nativeId): Promise<ResourceState> => {
      const inspected = await runner(["inspect", "--type", "container", "--format", "{{json .State}}\t{{json .Config.Labels}}", nativeId], {
        timeoutMs: 20_000
      });
      if (inspected.exitCode !== 0) {
        if (/no such (container|object)/i.test(inspected.stderr)) return { exists: false };
        throw new Error(`docker inspect failed with exit ${inspected.exitCode}`);
      }
      const [stateText = "{}", labelsText = "null"] = inspected.stdout.trim().split("\t");
      const state = JSON.parse(stateText) as InspectedState;
      const labels = (JSON.parse(labelsText) ?? {}) as Record<string, string>;
      return {
        exists: true,
        ...(state.Status ? { status: state.Status } : {}),
        owner: {
          ...(labels["fabric.job"] ? { job: labels["fabric.job"] } : {}),
          ...(labels["fabric.operation"] ? { operation: labels["fabric.operation"] } : {})
        }
      };
    },
    findCreated: async (operationId) => {
      const listed = await runner(["ps", "-a", "-q", "--no-trunc", "--filter", `label=fabric.operation=${operationId}`], { timeoutMs: 20_000 });
      if (listed.exitCode !== 0) throw new Error(`docker ps failed with exit ${listed.exitCode}`);
      return listed.stdout.split(/\s+/).find((id) => id.length > 0);
    },
    terminal: (action, state) => {
      if (action === "sandbox.destroy") return state.exists ? { terminal: false, ...(state.status ? { state: state.status } : {}) } : { terminal: true };
      return state.exists && state.status === "running"
        ? { terminal: true }
        : { terminal: false, state: state.exists ? (state.status ?? "unknown") : "absent" };
    },
    resourceName: (operationId) => `capsule-fabric-${operationId.toLowerCase()}`,
    secret: options.secret ?? (() => undefined),
    now: () => new Date()
  };
}
