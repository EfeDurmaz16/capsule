import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { APIError, Sandbox } from "@vercel/sandbox";

const port = 8765;
const root = "/tmp/fabric-job";
const workspace = root + "/work";
const result = root + "/output.tar.gz";
const limit = 64 * 1024 * 1024;

async function checked(sandbox: Sandbox, cmd: string, args: string[], cwd?: string) {
  const run = await sandbox.runCommand({ cmd, args, ...(cwd ? { cwd } : {}), timeoutMs: 120_000 });
  if (run.exitCode !== 0) throw new Error("sandbox command failed: " + cmd);
  return run;
}

function gone(error: unknown): boolean {
  return error instanceof APIError && [404, 410].includes(error.response.status);
}

async function collectWorkspace(sandbox: Sandbox, output: string) {
  await checked(sandbox, "tar", ["-czf", result, "-C", workspace, "."]);
  const size = await checked(sandbox, "stat", ["-c", "%s", result]);
  const length = Number((await size.stdout()).trim());
  if (!Number.isSafeInteger(length) || length < 1 || length > limit) throw new Error("output exceeds size limit");
  const downloaded = await sandbox.downloadFile({ path: result }, { path: output });
  if (!downloaded || (await stat(output)).size !== length) throw new Error("incomplete sandbox output");
}

async function freezeExecutor(sandbox: Sandbox) {
  await checked(sandbox, "sh", [
    "-eu",
    "-c",
    `
    [ -s "$1" ] || exit 0
    read -r pid < "$1"
    case "$pid" in ''|*[!0-9]*) exit 1;; esac
    [ -r "/proc/$pid/cmdline" ] || exit 0
    tr '\\000' ' ' < "/proc/$pid/cmdline" | grep -Fq "exec-server --listen ws://0.0.0.0:8765 --ws-auth capability-token" || exit 1
    freeze() {
      kill -STOP "$1" 2>/dev/null || return 0
      for child in $(ps -o pid= --ppid "$1"); do freeze "$child"; done
    }
    freeze "$pid"
  `,
    "freeze",
    root + "/executor.pid"
  ]);
}

/** Private, one-sandbox stdio session used by the Fabric Codex handoff command. */
export async function runVercelHandoff(): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const messages = input[Symbol.asyncIterator]();
  const interrupted = () => input.close();
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  let sandbox: Sandbox | undefined;
  let phase = "read request";
  let canDelete = true;
  let name = "fabric-handoff-" + randomBytes(10).toString("hex");
  try {
    const start = await messages.next();
    if (start.done) return;
    const request = JSON.parse(start.value) as Record<string, unknown>;
    if (request.name !== undefined) {
      if (typeof request.name !== "string" || !/^fabric-handoff-[a-f0-9]{40}$/.test(request.name)) {
        throw new Error("invalid handoff sandbox name");
      }
      name = request.name;
    }

    const accessToken = process.env.VERCEL_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID;
    if (accessToken && (!teamId || !projectId)) throw new Error("VERCEL_TOKEN requires team and project IDs");
    const credentials = accessToken && teamId && projectId ? { token: accessToken, teamId, projectId } : {};

    if (request.action === "recover" || request.action === "cleanup") {
      if (request.name === undefined || typeof request.output !== "string") throw new Error("invalid recovery request");
      canDelete = false;
      phase = "find original sandbox";
      try {
        sandbox = await Sandbox.get({ ...credentials, name, resume: false });
      } catch (error) {
        if (!gone(error)) throw error;
        process.stdout.write(JSON.stringify({ state: "missing" }) + "\n");
        return;
      }
      let state = "unavailable";
      if (request.action === "recover" && sandbox.status === "running") {
        phase = "freeze executor and collect partial output";
        try {
          const ready = await sandbox.runCommand("test", ["-f", root + "/checkpoint-ready"]);
          if (ready.exitCode === 0) {
            await freezeExecutor(sandbox);
            await collectWorkspace(sandbox, request.output);
            state = "collected";
          } else if (ready.exitCode !== 1) {
            throw new Error("could not inspect checkpoint");
          }
        } catch (error) {
          if (!gone(error)) throw error;
        }
      } else if (request.action === "recover" && sandbox.status === "pending") {
        throw new Error("sandbox is still provisioning");
      }
      process.stdout.write(JSON.stringify({ state }) + "\n");
      const saved = await messages.next();
      canDelete = !saved.done && saved.value === "saved";
      return;
    }

    if (
      request.action !== "start" ||
      typeof request.checkpoint !== "string" ||
      typeof request.output !== "string" ||
      typeof request.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(request.version)
    )
      throw new Error("invalid handoff request");
    if ((await stat(request.checkpoint)).size > limit) throw new Error("checkpoint exceeds size limit");

    phase = "create";
    sandbox = await Sandbox.create({
      ...credentials,
      name,
      ports: [port],
      persistent: false,
      timeout: 600_000,
      resources: { vcpus: 1 },
      networkPolicy: { allow: ["registry.npmjs.org"] }
    });

    phase = "install executor";
    await checked(sandbox, "sh", ["-eu", "-c", 'mkdir -m 700 "$1"; mkdir -m 700 "$1/auth" "$1/work"', "setup", root]);
    await checked(sandbox, "npm", ["install", "--no-audit", "--no-fund", "--prefix", root, "@openai/codex@" + request.version]);
    await sandbox.updateNetworkPolicy("deny-all");

    phase = "restore checkpoint";
    await sandbox.writeFiles([{ path: root + "/input.tar.gz", content: await readFile(request.checkpoint) }]);
    await checked(sandbox, "tar", ["-xzf", root + "/input.tar.gz", "-C", workspace]);

    await checked(sandbox, "touch", [root + "/checkpoint-ready"]);

    phase = "start authenticated executor";
    const token = randomBytes(32).toString("hex");
    const digest = createHash("sha256").update(token).digest("hex");
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-eu",
        "-c",
        'echo "$$" > "$1"; shift; exec "$@"',
        "executor",
        root + "/executor.pid",
        root + "/node_modules/.bin/codex",
        "exec-server",
        "--listen",
        "ws://0.0.0.0:" + port,
        "--ws-auth",
        "capability-token",
        "--ws-token-sha256",
        digest
      ],
      cwd: workspace,
      env: { CODEX_HOME: root + "/auth" },
      detached: true,
      timeoutMs: 540_000
    });
    await checked(sandbox, "node", [
      "-e",
      `const net = require("node:net"); let n = 0; const probe = () => { const s = net.connect(${port}, "127.0.0.1", () => s.end()); s.on("error", () => { if (++n === 50) process.exitCode = 1; else setTimeout(probe, 100); }); }; probe();`
    ]);
    const url = new URL(sandbox.domain(port));
    if (url.protocol !== "https:") throw new Error("executor route requires TLS");
    url.protocol = "wss:";
    canDelete = false;
    process.stdout.write(JSON.stringify({ state: "ready", name, url: url.href, token, cwd: workspace }) + "\n");

    phase = "collect output";
    const collect = await messages.next();
    if (collect.done || collect.value !== "collect") return;
    await collectWorkspace(sandbox, request.output);
    process.stdout.write(JSON.stringify({ state: "collected" }) + "\n");
    const saved = await messages.next();
    canDelete = !saved.done && saved.value === "saved";
  } catch {
    process.stderr.write("Capsule Vercel handoff failed during " + phase + " (" + name + ")\n");
    process.exitCode = 1;
  } finally {
    input.close();
    process.stdin.pause();
    if (sandbox && !canDelete) {
      process.stderr.write("Vercel sandbox retained until its timeout for output recovery: " + name + "\n");
      process.exitCode = 1;
    }
    if (sandbox && canDelete) {
      try {
        try {
          await sandbox.delete({ deleteOrphanSnapshots: true });
        } catch (error) {
          if (!gone(error)) throw error;
        }
        process.stdout.write(JSON.stringify({ state: "deleted", name }) + "\n");
      } catch {
        process.stderr.write("Could not delete Vercel sandbox " + name + "\n");
        process.exitCode = 1;
      }
    }
  }
}
