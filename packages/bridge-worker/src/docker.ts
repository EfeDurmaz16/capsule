import type { ReceiptStore } from "@capsule-sdk/core";
import { docker, runDocker, type DockerCommandResult, type RunDockerOptions } from "@capsule-sdk/docker";
import type { BridgeDriver, ResourceState } from "./driver.js";
import { wallClock } from "./observe.js";
import { dockerProfile } from "./profiles.js";
import { Refusal } from "./validate.js";

// The local Docker profile (draft P12 layer L3). Effects go through Capsule's Docker adapter with
// pull: never, so a create never reaches a registry. The bridge's reads are `docker inspect` and a
// label query; neither changes anything. Containers carry fabric.operation, fabric.job,
// fabric.attempt and fabric.generation labels, which is how a later request proves ownership and how
// a create of the same operation after a worker restart finds the container instead of making another.

type DockerRunner = (args: string[], options?: RunDockerOptions) => Promise<DockerCommandResult>;

export interface DockerDriverOptions {
  /**
   * The engine scope: the docker context every command is sent to. Omitted: the docker CLI's current
   * context, read once at the first request and then used for every command, even if the CLI switches.
   */
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
  const cli = options.runner ?? runDocker;
  let shown: Promise<Record<string, string>> | undefined;
  const binding = (): Promise<Record<string, string>> => {
    if (options.binding) return Promise.resolve({ ...options.binding });
    shown ??= cli(["context", "show"], { timeoutMs: 10_000 }).then((result) => {
      if (result.exitCode !== 0 || result.stdout.trim() === "") throw new Error("docker context show failed");
      return { engine: result.stdout.trim() };
    });
    shown.catch(() => {
      shown = undefined;
    });
    return shown;
  };
  // The engine scope is a route, not only a label: every command names the bound context, so the
  // engine a locator names is the engine the command reaches. Without --context the CLI would follow
  // DOCKER_CONTEXT or its current context, which can differ from a configured binding or change under
  // a running worker. The = form keeps the name one argument whatever it holds.
  // A docker exec client stays attached for as long as the command runs, and only runDocker's timer in
  // this process would end it, so it would outlive the worker. Killing that client does not stop the
  // command in the daemon, so it is killed when the session ends. Clients of create, start and rm are
  // left alone: killing one could abort the daemon's work, and they end when the daemon answers.
  const lifetime = new AbortController();
  const runner: DockerRunner = async (args, runOptions) => {
    const { engine } = await binding();
    return cli([`--context=${engine}`, ...args], args[0] === "exec" ? { ...runOptions, signal: lifetime.signal } : runOptions);
  };
  const checkAvailable =
    options.checkAvailable ??
    (async () => {
      try {
        return (await runner(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5_000 })).exitCode === 0;
      } catch {
        return false;
      }
    });
  const adapter = docker({ runner, checkAvailable, pull: "never" });
  return {
    profile: dockerProfile,
    clock: wallClock,
    binding,
    adapter: () => adapter,
    admit: (request) => {
      // Values here become docker CLI arguments. A leading dash would read as an option, and an = in a
      // label key or variable name would shift where docker splits the name from the value.
      const refuse = (detail: string) => new Refusal("provider_failed", "provider_refused", detail);
      if ("target" in request && request.target.native_id.startsWith("-")) return refuse("a container id cannot start with a dash");
      if (request.action === "sandbox.create") {
        if (request.params.image.startsWith("-")) return refuse("an image reference cannot start with a dash");
        if (Object.keys(request.params.labels).some((key) => key.includes("="))) return refuse("a label key cannot hold =");
        if (Object.keys(request.params.env).some((key) => key.includes("="))) return refuse("an environment variable name cannot hold =");
      }
      return undefined;
    },
    ...(options.receipts ? { receipts: options.receipts } : {}),
    read: async (nativeId): Promise<ResourceState> => {
      if (nativeId.startsWith("-")) return { exists: false };
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
    now: () => new Date(),
    close: () => lifetime.abort()
  };
}
