import {
  AdapterExecutionError,
  type AdapterContext,
  type CapsuleAdapter,
  type CapabilityMap,
  type CreateMachineSpec,
  type DestroyMachineSpec,
  type JobRun,
  type Machine,
  type MachineLifecycleResult,
  type MachineStatusResult,
  type MachineStatusSpec,
  type RunJobSpec,
  type StartMachineSpec,
  type StopMachineSpec
} from "@capsule/core";
import { FlyClient, type FlyClientOptions } from "./fly-client.js";

export interface FlyAdapterOptions extends FlyClientOptions {
  appName?: string;
  region?: string;
  defaultImage?: string;
  memoryMb?: number;
  cpus?: number;
  cpuKind?: "shared" | "performance";
}

interface FlyMachine {
  id: string;
  name?: string;
  state?: string;
  region?: string;
  instance_id?: string;
}

const provider = "fly";
const adapter = "fly";

export const flyCapabilities: CapabilityMap = {
  job: {
    run: "native",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "native",
    resources: "experimental"
  },
  machine: {
    create: "native",
    status: "native",
    exec: "unsupported",
    start: "native",
    stop: "native",
    destroy: "native",
    snapshot: "unsupported",
    volume: "unsupported",
    network: "experimental"
  }
};

function appName(options: FlyAdapterOptions): string {
  const app = options.appName ?? process.env.FLY_APP_NAME;
  if (!app) {
    throw new AdapterExecutionError("Fly adapter requires appName or FLY_APP_NAME.");
  }
  return app;
}

function machineStatus(state: string | undefined): Machine["status"] {
  if (state === "started") return "running";
  if (state === "stopped" || state === "suspended") return "stopped";
  if (state === "destroyed") return "deleted";
  if (state === "created" || state === "starting") return "creating";
  return "failed";
}

function machineBody(spec: CreateMachineSpec | RunJobSpec, options: FlyAdapterOptions, job = false) {
  const image = spec.image ?? options.defaultImage;
  if (!image) {
    throw new AdapterExecutionError("Fly machine creation requires spec.image or adapter defaultImage.");
  }
  const command = "command" in spec ? spec.command : undefined;
  return {
    name: spec.name,
    region: "region" in spec ? (spec.region ?? options.region) : options.region,
    config: {
      image,
      env: spec.env,
      guest: {
        cpu_kind: options.cpuKind ?? "shared",
        cpus: "resources" in spec ? (spec.resources?.cpu ?? options.cpus) : options.cpus,
        memory_mb: "resources" in spec ? (spec.resources?.memoryMb ?? options.memoryMb) : options.memoryMb
      },
      restart: job ? { policy: "no" } : undefined,
      processes: command ? [{ cmd: Array.isArray(command) ? command : ["sh", "-lc", command] }] : undefined
    },
    auto_destroy: job
  };
}

function receipt(context: AdapterContext, input: { type: "machine.create" | "machine.status" | "machine.start" | "machine.stop" | "machine.destroy" | "job.run"; path: string; startedAt: Date; id: string; name?: string; status: string; metadata?: Record<string, unknown> }) {
  return context.receipts
    ? context.createReceipt({
        type: input.type,
        capabilityPath: input.path,
        startedAt: input.startedAt,
        policy: {
          decision: "allowed",
          applied: context.policy,
          notes: [
            "Fly Machines operation is native through the Machines API.",
            "Capsule does not hide Fly app, region, networking, volume, autostart/autostop, or process model semantics."
          ]
        },
        resource: { id: input.id, name: input.name, status: input.status },
        metadata: input.metadata
      })
    : undefined;
}

export function fly(options: FlyAdapterOptions = {}): CapsuleAdapter {
  const getClient = () => new FlyClient(options);
  const getApp = () => appName(options);
  return {
    name: adapter,
    provider,
    capabilities: flyCapabilities,
    raw: { appName: options.appName, region: options.region, baseUrl: options.baseUrl ?? "https://api.machines.dev" },
    machine: {
      create: async (spec: CreateMachineSpec, context: AdapterContext): Promise<Machine> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env });
        const response = await getClient().request<FlyMachine>({
          method: "POST",
          path: `/v1/apps/${encodeURIComponent(getApp())}/machines`,
          body: machineBody(spec, options)
        });
        const status = machineStatus(response.state);
        const createdReceipt = context.receipts
          ? context.createReceipt({
              type: "machine.create",
              capabilityPath: "machine.create",
              startedAt,
              image: spec.image ?? options.defaultImage,
              policy: {
                ...policy,
                notes: [
                  ...policy.notes,
                  "Fly Machines create is native.",
                  "Machine placement, networking, volumes, services, and autostart/autostop remain Fly-specific."
                ]
              },
              resource: { id: response.id, name: response.name ?? spec.name, status },
              metadata: { appName: getApp(), region: response.region ?? spec.region ?? options.region, state: response.state, instanceId: response.instance_id }
            })
          : undefined;
        return { id: response.id, provider, name: response.name ?? spec.name, status, receipt: createdReceipt };
      },
      status: async (spec: MachineStatusSpec, context: AdapterContext): Promise<MachineStatusResult> => {
        const startedAt = new Date();
        const response = await getClient().request<FlyMachine>({ path: `/v1/apps/${encodeURIComponent(getApp())}/machines/${encodeURIComponent(spec.id)}` });
        const status = machineStatus(response.state);
        return {
          id: response.id,
          provider,
          name: response.name,
          status,
          receipt: receipt(context, { type: "machine.status", path: "machine.status", startedAt, id: response.id, name: response.name, status, metadata: { state: response.state } }),
          metadata: { state: response.state, region: response.region }
        };
      },
      start: async (spec: StartMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        const response = await getClient().request<FlyMachine>({ method: "POST", path: `/v1/apps/${encodeURIComponent(getApp())}/machines/${encodeURIComponent(spec.id)}/start` });
        const status = machineStatus(response.state) === "running" ? "running" : "starting";
        return { id: response.id ?? spec.id, provider, status, receipt: receipt(context, { type: "machine.start", path: "machine.start", startedAt, id: response.id ?? spec.id, status, metadata: { state: response.state, reason: spec.reason } }), metadata: { state: response.state } };
      },
      stop: async (spec: StopMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        const response = await getClient().request<FlyMachine>({ method: "POST", path: `/v1/apps/${encodeURIComponent(getApp())}/machines/${encodeURIComponent(spec.id)}/stop`, body: spec.force ? { signal: "SIGKILL" } : undefined });
        const status = machineStatus(response.state) === "stopped" ? "stopped" : "stopping";
        return { id: response.id ?? spec.id, provider, status, receipt: receipt(context, { type: "machine.stop", path: "machine.stop", startedAt, id: response.id ?? spec.id, status, metadata: { state: response.state, force: spec.force, reason: spec.reason } }), metadata: { state: response.state } };
      },
      destroy: async (spec: DestroyMachineSpec, context: AdapterContext): Promise<MachineLifecycleResult> => {
        const startedAt = new Date();
        await getClient().request<unknown>({ method: "DELETE", path: `/v1/apps/${encodeURIComponent(getApp())}/machines/${encodeURIComponent(spec.id)}` });
        return { id: spec.id, provider, status: "deleted", receipt: receipt(context, { type: "machine.destroy", path: "machine.destroy", startedAt, id: spec.id, status: "deleted", metadata: { force: spec.force, reason: spec.reason } }) };
      }
    },
    job: {
      run: async (spec: RunJobSpec, context: AdapterContext): Promise<JobRun> => {
        const startedAt = new Date();
        const policy = context.evaluatePolicy({ env: spec.env, timeoutMs: spec.timeoutMs });
        const response = await getClient().request<FlyMachine>({
          method: "POST",
          path: `/v1/apps/${encodeURIComponent(getApp())}/machines`,
          body: machineBody(spec, options, true)
        });
        const status = machineStatus(response.state);
        return {
          id: response.id,
          provider,
          status: status === "failed" ? "failed" : "running",
          receipt: context.receipts
            ? context.createReceipt({
                type: "job.run",
                capabilityPath: "job.run",
                startedAt,
                image: spec.image,
                command: Array.isArray(spec.command) ? spec.command : spec.command ? ["sh", "-lc", spec.command] : undefined,
                policy: {
                  ...policy,
                  notes: [
                    ...policy.notes,
                    "Fly job.run creates an auto-destroy Fly Machine with restart policy no.",
                    "Logs, exit code collection, and wait semantics are not implemented yet."
                  ]
                },
                resource: { id: response.id, name: response.name ?? spec.name, status: response.state },
                metadata: { appName: getApp(), region: response.region ?? options.region, autoDestroy: true }
              })
            : undefined
        };
      }
    }
  };
}
