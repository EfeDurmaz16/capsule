import { beforeAll, describe, expect, test } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { liveTest, liveTestGate, type LiveTestGate } from "@capsule/test-utils";
import { docker, dockerAvailable, runDocker } from "./index.js";
import { dockerSandboxCreateArgs } from "./docker-adapter.js";

const hasDocker = await dockerAvailable();
const dockerLiveGate: LiveTestGate = hasDocker ? liveTestGate({ provider: "docker" }) : { enabled: false, skipReason: "Docker is not available." };
const dockerLiveEnabled = dockerLiveGate.enabled;

beforeAll(async () => {
  if (!dockerLiveEnabled) {
    return;
  }
  const pulled = await runDocker(["pull", "node:22"], { timeoutMs: 120_000 });
  expect(pulled.exitCode).toBe(0);
}, 130_000);

function uniqueName(label: string): string {
  return `capsule-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function containerExists(id: string): Promise<boolean> {
  const inspected = await runDocker(["inspect", id], { timeoutMs: 10_000 });
  return inspected.exitCode === 0;
}

function runLiveDocker(name: string, fn: () => unknown | Promise<unknown>, timeout?: number): void {
  liveTest(test, name, dockerLiveGate, fn, timeout);
}

describe("docker adapter", () => {
  test("runs the shared adapter contract suite", async () => {
    await runAdapterContract(docker());
  });

  test("declares Docker capabilities", () => {
    const capsule = new Capsule({ adapter: docker() });
    expect(capsule.supportLevel("sandbox.exec")).toBe("native");
    expect(capsule.supportLevel("sandbox.exposePort")).toBe("native");
    expect(capsule.supportLevel("sandbox.snapshot")).toBe("unsupported");
    expect(capsule.supportLevel("sandbox.restore")).toBe("unsupported");
    expect(capsule.supports("sandbox.snapshot")).toBe(false);
    expect(capsule.supports("sandbox.restore")).toBe(false);
    expect(capsule.supportLevel("job.run")).toBe("native");
    expect(capsule.supports("service.deploy")).toBe(false);
  });

  test("does not expose unsupported Docker sandbox snapshot or restore APIs", () => {
    const adapter = docker();

    expect(adapter.capabilities.sandbox?.snapshot).toBe("unsupported");
    expect(adapter.capabilities.sandbox?.restore).toBe("unsupported");
    expect(adapter.sandbox).not.toHaveProperty("snapshot");
    expect(adapter.sandbox).not.toHaveProperty("restore");
  });

  test("maps sandbox exposed ports to local-only Docker publish flags", () => {
    const args = dockerSandboxCreateArgs({
      name: "capsule-port-test",
      workdir: "/workspace",
      image: "node:22",
      exposedPorts: [
        { containerPort: 3000, hostPort: 13000 },
        { containerPort: 9229, protocol: "tcp" },
        { containerPort: 5353, hostPort: 15353, protocol: "udp", hostIp: "127.0.0.2" }
      ]
    });

    expect(args).toContain("--publish");
    expect(args).toContain("127.0.0.1:13000:3000/tcp");
    expect(args).toContain("127.0.0.1::9229/tcp");
    expect(args).toContain("127.0.0.2:15353:5353/udp");
  });

  test("keeps sandbox port exposure compatible with network none", () => {
    const args = dockerSandboxCreateArgs({
      name: "capsule-port-network-test",
      workdir: "/workspace",
      image: "node:22",
      networkNone: true,
      exposedPorts: [{ containerPort: 8080, hostPort: 18080 }]
    });

    expect(args).toEqual(expect.arrayContaining(["--network", "none", "--publish", "127.0.0.1:18080:8080/tcp"]));
  });

  runLiveDocker("runs Docker job when live tests and Docker are available", async () => {
    const capsule = new Capsule({ adapter: docker(), receipts: true });
    const run = await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('docker ok')"], timeoutMs: 30_000 });
    expect(run.result?.stdout).toContain("docker ok");
    expect(run.receipt?.type).toBe("job.run");
  }, 60_000);

  runLiveDocker("covers sandbox create, exec, file read/write/list, and destroy", async () => {
    const capsule = new Capsule({ adapter: docker(), receipts: true });
    const sandbox = await capsule.sandbox.create({ image: "node:22", name: uniqueName("sandbox"), timeoutMs: 30_000 });
    const id = sandbox.handle.id;
    try {
      await sandbox.writeFile("/workspace/capsule/live.txt", "hello from docker sandbox");
      const file = await sandbox.readFile("/workspace/capsule/live.txt");
      const entries = await sandbox.listFiles("/workspace/capsule");
      const exec = await sandbox.exec({ command: ["node", "-e", "const fs=require('fs'); console.log(fs.readFileSync('/workspace/capsule/live.txt','utf8'))"] });

      expect(new TextDecoder().decode(file)).toBe("hello from docker sandbox");
      expect(entries).toContainEqual(expect.objectContaining({ name: "live.txt", path: "/workspace/capsule/live.txt", type: "file" }));
      expect(exec.exitCode).toBe(0);
      expect(exec.stdout).toContain("hello from docker sandbox");
      expect(exec.receipt?.type).toBe("sandbox.exec");
    } finally {
      await sandbox.destroy();
    }

    expect(await containerExists(id)).toBe(false);
  }, 90_000);

  runLiveDocker("covers Docker job.run timeout behavior", async () => {
    const capsule = new Capsule({ adapter: docker(), receipts: true });
    const run = await capsule.job.run({
      image: "node:22",
      command: ["node", "-e", "setTimeout(() => console.log('late'), 10_000)"],
      timeoutMs: 1_000
    });

    expect(run.status).toBe("failed");
    expect(run.result?.exitCode).toBe(124);
    expect(run.result?.stderr).toContain("Command timed out after 1000ms");
    expect(run.receipt?.type).toBe("job.run");
  }, 60_000);

  runLiveDocker("covers Docker network none behavior for job.run", async () => {
    const capsule = new Capsule({
      adapter: docker(),
      receipts: true,
      policy: { network: { mode: "none" } }
    });
    const run = await capsule.job.run({
      image: "node:22",
      command: [
        "node",
        "-e",
        "fetch('https://example.com').then(() => process.exit(0)).catch(() => { console.error('network blocked'); process.exit(42); })"
      ],
      timeoutMs: 30_000
    });

    expect(run.status).toBe("failed");
    expect(run.result?.exitCode).toBe(42);
    expect(run.result?.stderr).toContain("network blocked");
    expect(run.receipt?.policy.notes).toContain("Docker network policy applied with --network none.");
  }, 60_000);

  runLiveDocker("cleans up sandbox containers when a live test fails after create", async () => {
    const capsule = new Capsule({ adapter: docker(), receipts: true });
    let id: string | undefined;
    const sentinel = new Error("simulated test failure");

    await expect(async () => {
      const sandbox = await capsule.sandbox.create({ image: "node:22", name: uniqueName("cleanup"), timeoutMs: 30_000 });
      id = sandbox.handle.id;
      try {
        throw sentinel;
      } finally {
        await sandbox.destroy();
      }
    }).rejects.toThrow(sentinel);

    expect(id).toBeDefined();
    expect(await containerExists(id!)).toBe(false);
  }, 60_000);
});
