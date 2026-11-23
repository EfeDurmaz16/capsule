import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { APIError, Sandbox as VercelSandbox } from "@vercel/sandbox";
import { CaptureBudget, ProviderValidationError, resolveExecOutputBounds, type CapsuleAdapter, type CapsulePolicy, type Sandbox } from "@capsule-sdk/core";
import type { BridgeDriver } from "./driver.js";
import { wallClock } from "./observe.js";
import { vercelProfile } from "./profiles.js";
import { Refusal } from "./validate.js";

export interface VercelDriverOptions {
  binding: { account: string; project: string };
  token: string;
  sdk?: Pick<typeof VercelSandbox, "create" | "get">;
}

const capabilities = {
  sandbox: { create: "native", exec: "native", fileRead: "native", fileWrite: "native", fileList: "native", destroy: "native" }
} as const;

function nameFor(key: string): string {
  return "fabric-" + createHash("sha256").update(key).digest("hex").slice(0, 40);
}

function missing(error: unknown): boolean {
  return error instanceof APIError && error.response.status === 404;
}

export function vercelDriver(options: VercelDriverOptions): BridgeDriver {
  const sdk = options.sdk ?? VercelSandbox;
  const { account: teamId, project: projectId } = options.binding;
  const credentials = { teamId, projectId, token: options.token };

  async function get(name: string): Promise<VercelSandbox | undefined> {
    try {
      return await sdk.get({ ...credentials, name, resume: false });
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  const adapter: BridgeDriver["adapter"] = (hooks): CapsuleAdapter => {
    const wrap = (sandbox: VercelSandbox, policy: CapsulePolicy): Sandbox => ({
      handle: { id: sandbox.name, provider: "vercel", createdAt: sandbox.createdAt.toISOString() },
      async exec(spec) {
        if (sandbox.status !== "running") throw new ProviderValidationError("sandbox is not running", { category: "validation", retryable: false });
        if (typeof spec.command === "string" || !spec.command[0]) {
          throw new ProviderValidationError("Vercel exec requires argv", { category: "validation", retryable: false });
        }
        const [cmd, ...args] = spec.command;
        const bounds = resolveExecOutputBounds({ deadlineMs: (spec.timeoutMs ?? 60_000) + 10_000, ...spec.bounds }, policy);
        const budgets = { stdout: new CaptureBudget(bounds.stdout), stderr: new CaptureBudget(bounds.stderr) };
        const output = { stdout: "", stderr: "" };
        const command = await sandbox.runCommand({
          cmd,
          args,
          detached: true,
          ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
          ...(spec.env === undefined ? {} : { env: spec.env }),
          ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
          ...(spec.input === undefined ? {} : { stdin: Readable.from([spec.input]) })
        });
        hooks.onRunning("running");
        const capture = async () => {
          const signal = AbortSignal.timeout(Math.max(bounds.stdout.deadlineMs, bounds.stderr.deadlineMs));
          for await (const { stream, data } of command.logs({ signal })) {
            if (stream === "stdout" || stream === "stderr") output[stream] += budgets[stream].takeText(data);
          }
        };
        const [completed] = await Promise.all([command.wait(), capture()]);
        return {
          exitCode: completed.exitCode,
          ...output,
          logs: [],
          artifacts: [],
          truncation: { stdout: budgets.stdout.truncation(), stderr: budgets.stderr.truncation() }
        };
      },
      async writeFile(path, content) {
        await sandbox.writeFiles([{ path, content }]);
      },
      async readFile(path) {
        const data = await sandbox.readFileToBuffer({ path });
        if (data === null) throw new ProviderValidationError("file does not exist", { category: "validation", retryable: false });
        return data;
      },
      async listFiles(path) {
        const entries = await sandbox.fs.readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          path: posix.join(path, entry.name),
          type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unknown"
        }));
      },
      async destroy() {
        try {
          await sandbox.delete({ deleteOrphanSnapshots: true });
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    });

    return {
      name: "vercel-sandbox",
      provider: "vercel",
      capabilities,
      sandbox: {
        async create(spec, context) {
          const sandbox = await sdk.create({
            ...credentials,
            name: nameFor(hooks.operation.key),
            persistent: false,
            timeout: 300_000,
            resources: { vcpus: 1 },
            ...(spec.image === undefined ? {} : { image: spec.image }),
            ...(spec.env === undefined ? {} : { env: spec.env }),
            ...(spec.labels === undefined ? {} : { tags: spec.labels })
          });
          return wrap(sandbox, context.policy);
        },
        async attach(spec, context) {
          const sandbox = await get(spec.id);
          if (!sandbox) throw new ProviderValidationError("sandbox does not exist", { category: "validation", retryable: false });
          return wrap(sandbox, context.policy);
        }
      }
    };
  };

  return {
    profile: vercelProfile,
    clock: wallClock,
    binding: async () => ({ ...options.binding }),
    adapter,
    admit(request) {
      if (request.action === "sandbox.create" && Object.keys(request.params.labels).length > 0) {
        return new Refusal("provider_failed", "provider_refused", "Vercel bridge reserves sandbox tags for Fabric ownership");
      }
      return undefined;
    },
    async read(nativeId) {
      const sandbox = await get(nativeId);
      if (!sandbox) return { exists: false };
      const job = sandbox.tags?.["fabric.job"];
      const operation = sandbox.tags?.["fabric.operation"];
      return {
        exists: true,
        status: sandbox.status,
        owner: { ...(job ? { job } : {}), ...(operation ? { operation } : {}) }
      };
    },
    async findCreated(operationId, key) {
      const sandbox = await get(nameFor(key));
      if (!sandbox) return undefined;
      if (sandbox.tags?.["fabric.operation"] !== operationId) throw new Error("Vercel sandbox name collision");
      return sandbox.name;
    },
    terminal(action, state) {
      if (action === "sandbox.destroy" && !state.exists) return { terminal: true };
      if (action !== "sandbox.destroy" && state.status === "running") return { terminal: true };
      return { terminal: false, state: state.status ?? "absent" };
    },
    resourceName: (_operationId, key) => nameFor(key),
    secret: () => undefined,
    now: () => new Date()
  };
}
