import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  Capsule,
  MemoryReceiptStore,
  ProviderRetryableError,
  ProviderValidationError,
  runAdapterContract,
  sha256
} from "@capsule-sdk/core";
import type { DockerCommandResult, RunDockerOptions } from "./docker-cli.js";
import { liveTest, liveTestGate, type LiveTestGate } from "@capsule-sdk/test-utils";
import { classifyDockerCliError, docker, dockerAvailable, runDocker } from "./index.js";
import { dockerSandboxCreateArgs } from "./docker-adapter.js";
import { normalizeDockerReceiptFixtures } from "./docker-receipt-fixtures.js";

function dockerResult(exitCode: number, stderr = ""): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode, stdout: "", stderr };
}

const configuredDockerLiveGate = liveTestGate({ provider: "docker" });
const hasDocker = configuredDockerLiveGate.enabled ? await dockerAvailable() : false;
const dockerLiveGate: LiveTestGate =
  configuredDockerLiveGate.enabled && !hasDocker ? { enabled: false, skipReason: "Docker is not available." } : configuredDockerLiveGate;
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
  test("runs the shared adapter contract suite and classifies daemon reachability failures", async () => {
    const unreachable = docker({ checkAvailable: async () => false });
    await runAdapterContract(unreachable, {
      failureScenarios: [
        {
          name: "Unreachable Docker daemon surfaces as a retryable provider error",
          exercise: (capsule) => capsule.job.run({ image: "node:22", command: ["node", "-e", "0"] }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderRetryableError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "retryable", retryable: true } });
          }
        }
      ]
    });
  });

  test("classifies Docker CLI exit codes and stderr signals conservatively", () => {
    expect(classifyDockerCliError(1, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock")).toMatchObject({
      category: "retryable",
      retryable: true
    });
    expect(classifyDockerCliError(124, "")).toMatchObject({ category: "retryable", retryable: true });
    expect(classifyDockerCliError(1, "Unable to find image 'nope:latest' locally\nmanifest unknown")).toMatchObject({
      category: "validation",
      retryable: false
    });
    expect(classifyDockerCliError(1, "Error: No such container: capsule-123")).toMatchObject({ category: "validation", retryable: false });
    expect(classifyDockerCliError(1, "permission denied while trying to connect to the Docker daemon socket")).toMatchObject({
      category: "auth",
      retryable: false
    });
    expect(classifyDockerCliError(1, "denied: requested access to the resource is denied")).toMatchObject({ category: "auth", retryable: false });
    expect(
      classifyDockerCliError(1, "error getting credentials - err: exit status 1, out: `The user name or passphrase you entered is not correct.`")
    ).toMatchObject({
      category: "auth",
      retryable: false
    });
    expect(classifyDockerCliError(1, "some other failure")).toMatchObject({ category: "unknown", retryable: false });
  });

  test("classifies a failed docker create as a validation provider error", async () => {
    const capsule = new Capsule({
      adapter: docker({
        checkAvailable: async () => true,
        runner: async (args) => (args[0] === "create" ? dockerResult(1, "Unable to find image 'ghost:latest' locally\nmanifest unknown") : dockerResult(0))
      })
    });

    let thrown: unknown;
    try {
      await capsule.sandbox.create({ image: "ghost:latest", name: "capsule-missing" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderValidationError);
    expect((thrown as Error).message).toContain("docker create failed");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "validation", retryable: false } });
  });

  test("normalizes exec output into stdout/stderr log entries tagged with the container id source", async () => {
    const containerId = "c0ffee1234567890";
    const capsule = new Capsule({
      adapter: docker({
        checkAvailable: async () => true,
        runner: async (args) => {
          if (args[0] === "create") return { exitCode: 0, stdout: `${containerId}\n`, stderr: "" };
          if (args[0] === "start") return dockerResult(0);
          if (args[0] === "exec") return { exitCode: 0, stdout: "line one\nline two\n", stderr: "boom\n" };
          return dockerResult(0);
        }
      })
    });

    const sandbox = await capsule.sandbox.create({ image: "node:22", name: "capsule-normalize" });
    const exec = await sandbox.exec({ command: ["node", "-e", "0"] });

    expect(exec.logs).toEqual([
      { timestamp: expect.any(String), stream: "stdout", message: "line one", source: containerId },
      { timestamp: expect.any(String), stream: "stdout", message: "line two", source: containerId },
      { timestamp: expect.any(String), stream: "stderr", message: "boom", source: containerId }
    ]);
  });

  test("collects sandbox exec artifacts from the live container via docker cp", async () => {
    const runner = async (args: string[], _options?: RunDockerOptions): Promise<DockerCommandResult> => {
      if (args[0] === "create") {
        return { exitCode: 0, stdout: "container-artifacts", stderr: "" };
      }
      if (args[0] === "cp") {
        // args: ["cp", "<id>:<path>", <destDir>]; simulate docker copying the file out.
        writeFileSync(join(args[2]!, "out.txt"), "artifact body");
        return dockerResult(0);
      }
      return dockerResult(0);
    };
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner }), receipts: true });
    const sandbox = await capsule.sandbox.create({ image: "node:22", name: "capsule-artifacts" });
    const exec = await sandbox.exec({ command: ["true"], artifactPaths: ["/workspace/out.txt"] });

    expect(exec.artifacts).toEqual([{ name: "out.txt", path: "out.txt", sizeBytes: 13, sha256: sha256("artifact body") }]);
    expect(exec.receipt?.artifactHashes).toEqual([sha256("artifact body")]);
  });

  test("returns no artifacts when sandbox exec does not request any", async () => {
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner: async () => dockerResult(0) }), receipts: true });
    const sandbox = await capsule.sandbox.create({ image: "node:22", name: "capsule-no-artifacts" });
    const exec = await sandbox.exec({ command: ["true"] });
    expect(exec.artifacts).toEqual([]);
  });

  test("surfaces a docker cp artifact failure as a provider error", async () => {
    const runner = async (args: string[]): Promise<DockerCommandResult> =>
      args[0] === "cp" ? dockerResult(1, "Error: No such container:path") : args[0] === "create" ? { exitCode: 0, stdout: "id", stderr: "" } : dockerResult(0);
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner }) });
    const sandbox = await capsule.sandbox.create({ image: "node:22", name: "capsule-artifacts-fail" });
    await expect(sandbox.exec({ command: ["true"], artifactPaths: ["/workspace/missing.txt"] })).rejects.toThrow("docker cp artifact failed");
  });

  test("job.run returns no artifacts because --rm removes the container before collection", async () => {
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner: async () => dockerResult(0) }), receipts: true });
    const run = await capsule.job.run({ image: "node:22", command: ["true"] });
    expect(run.result?.artifacts).toEqual([]);
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
      labels: { capsule_operation_key: "abc123", capsule_operation_scope: "sandbox_create" },
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
    expect(args).toEqual(expect.arrayContaining(["--label", "capsule_operation_key=abc123", "--label", "capsule_operation_scope=sandbox_create"]));
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

  runLiveDocker(
    "runs Docker job when live tests and Docker are available",
    async () => {
      const capsule = new Capsule({ adapter: docker(), receipts: true });
      const run = await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('docker ok')"], timeoutMs: 30_000 });
      expect(run.result?.stdout).toContain("docker ok");
      expect(run.receipt?.type).toBe("job.run");
    },
    60_000
  );

  runLiveDocker(
    "matches normalized live Docker receipt fixtures",
    async () => {
      const store = new MemoryReceiptStore();
      const capsule = new Capsule({ adapter: docker(), receipts: true, receiptStore: store });
      const sandbox = await capsule.sandbox.create({ image: "node:22", name: uniqueName("receipt-fixture"), timeoutMs: 30_000 });

      try {
        const exec = await sandbox.exec({ command: ["node", "-e", "console.log('sandbox fixture')"], timeoutMs: 30_000 });
        expect(exec.exitCode).toBe(0);
        expect(exec.stdout).toBe("sandbox fixture\n");
      } finally {
        await sandbox.destroy();
      }

      const run = await capsule.job.run({
        image: "node:22",
        name: "capsule-receipt-fixture-job",
        command: ["node", "-e", "console.log('job fixture')"],
        timeoutMs: 30_000
      });

      expect(run.status).toBe("succeeded");
      expect(run.result?.stdout).toBe("job fixture\n");
      expect(normalizeDockerReceiptFixtures(store.receipts)).toMatchInlineSnapshot(`
      [
        {
          "adapter": "docker",
          "capabilityPath": "sandbox.create",
          "durationMs": "<duration-ms>",
          "finishedAt": "<finished-at>",
          "id": "<receipt-id>",
          "image": "node:22",
          "policy": {
            "applied": {},
            "decision": "allowed",
            "notes": [
              "Docker local is not safe for hostile untrusted code unless the host Docker environment is hardened.",
            ],
          },
          "provider": "docker",
          "resource": {
            "id": "<docker-resource-id>",
            "name": "<docker-resource-name>",
            "status": "running",
          },
          "startedAt": "<started-at>",
          "supportLevel": "native",
          "type": "sandbox.create",
        },
        {
          "adapter": "docker",
          "capabilityPath": "sandbox.exec",
          "command": [
            "node",
            "-e",
            "console.log('sandbox fixture')",
          ],
          "durationMs": "<duration-ms>",
          "exitCode": 0,
          "finishedAt": "<finished-at>",
          "id": "<receipt-id>",
          "policy": {
            "applied": {},
            "decision": "allowed",
            "notes": [
              "Docker local is not safe for hostile untrusted code unless the host Docker environment is hardened.",
            ],
          },
          "provider": "docker",
          "resource": {
            "id": "<docker-resource-id>",
            "status": "running",
          },
          "startedAt": "<started-at>",
          "stderrHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stdoutHash": "7e1e82f0b9747ea9a51b310275d0d11da40bb5e5711fde334dc4e10212ba9ced",
          "supportLevel": "native",
          "type": "sandbox.exec",
        },
        {
          "adapter": "docker",
          "capabilityPath": "sandbox.destroy",
          "durationMs": "<duration-ms>",
          "finishedAt": "<finished-at>",
          "id": "<receipt-id>",
          "policy": {
            "applied": {},
            "decision": "allowed",
            "notes": [
              "Docker local is not safe for hostile untrusted code unless the host Docker environment is hardened.",
            ],
          },
          "provider": "docker",
          "resource": {
            "id": "<docker-resource-id>",
            "status": "deleted",
          },
          "startedAt": "<started-at>",
          "supportLevel": "native",
          "type": "sandbox.destroy",
        },
        {
          "adapter": "docker",
          "capabilityPath": "job.run",
          "command": [
            "node",
            "-e",
            "console.log('job fixture')",
          ],
          "durationMs": "<duration-ms>",
          "exitCode": 0,
          "finishedAt": "<finished-at>",
          "id": "<receipt-id>",
          "image": "node:22",
          "policy": {
            "applied": {},
            "decision": "allowed",
            "notes": [
              "Docker local is not safe for hostile untrusted code unless the host Docker environment is hardened.",
            ],
          },
          "provider": "docker",
          "resource": {
            "id": "<docker-resource-id>",
            "name": "capsule-receipt-fixture-job",
            "status": "succeeded",
          },
          "startedAt": "<started-at>",
          "stderrHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stdoutHash": "bae360ea25b96d08bc8ddfb907fbfd703c6a93fcbfed56bf518b8913f47a90ce",
          "supportLevel": "native",
          "type": "job.run",
        },
      ]
    `);
    },
    90_000
  );

  runLiveDocker(
    "covers sandbox create, exec, file read/write/list, and destroy",
    async () => {
      const capsule = new Capsule({ adapter: docker(), receipts: true });
      const sandbox = await capsule.sandbox.create({ image: "node:22", name: uniqueName("sandbox"), timeoutMs: 30_000 });
      const id = sandbox.handle.id;
      try {
        await sandbox.writeFile("/workspace/capsule/live.txt", "hello from docker sandbox");
        const file = await sandbox.readFile("/workspace/capsule/live.txt");
        const entries = await sandbox.listFiles("/workspace/capsule");
        const exec = await sandbox.exec({
          command: ["node", "-e", "const fs=require('fs'); console.log(fs.readFileSync('/workspace/capsule/live.txt','utf8'))"]
        });

        expect(new TextDecoder().decode(file)).toBe("hello from docker sandbox");
        expect(entries).toContainEqual(expect.objectContaining({ name: "live.txt", path: "/workspace/capsule/live.txt", type: "file" }));
        expect(exec.exitCode).toBe(0);
        expect(exec.stdout).toContain("hello from docker sandbox");
        expect(exec.receipt?.type).toBe("sandbox.exec");
      } finally {
        await sandbox.destroy();
      }

      expect(await containerExists(id)).toBe(false);
    },
    90_000
  );

  runLiveDocker(
    "covers Docker job.run timeout behavior",
    async () => {
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
    },
    60_000
  );

  runLiveDocker(
    "covers Docker network none behavior for job.run",
    async () => {
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
    },
    60_000
  );

  runLiveDocker(
    "cleans up sandbox containers when a live test fails after create",
    async () => {
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
    },
    60_000
  );
});
