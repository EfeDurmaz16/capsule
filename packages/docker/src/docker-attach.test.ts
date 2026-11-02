import { describe, expect, test } from "vitest";
import { Capsule, MemoryReceiptStore, ProviderValidationError } from "@capsule-sdk/core";
import type { DockerCommandResult, RunDockerOptions } from "./docker-cli.js";
import { docker } from "./index.js";

type Call = { args: string[]; options?: RunDockerOptions };

function recordingRunner(reply: (args: string[]) => DockerCommandResult): {
  calls: Call[];
  runner: (args: string[], options?: RunDockerOptions) => Promise<DockerCommandResult>;
} {
  const calls: Call[] = [];
  return {
    calls,
    runner: async (args, options) => {
      calls.push({ args, ...(options ? { options } : {}) });
      return reply(args);
    }
  };
}

describe("docker sandbox attach and pull policy", () => {
  test("attach only inspects the container, then exec and destroy act on that id", async () => {
    const { calls, runner } = recordingRunner((args) =>
      args[0] === "inspect" ? { exitCode: 0, stdout: "2026-10-27T10:00:00Z\n", stderr: "" } : { exitCode: 0, stdout: "hi\n", stderr: "" }
    );
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner }), receipts: true, receiptStore: store });
    const sandbox = await capsule.sandbox.attach({ id: "abc123" });
    expect(sandbox.handle).toMatchObject({ id: "abc123", provider: "docker", createdAt: "2026-10-27T10:00:00Z" });
    expect(calls.map((call) => call.args[0])).toEqual(["inspect"]);
    expect(store.receipts).toEqual([]);
    const result = await sandbox.exec({ command: ["echo", "hi"] });
    expect(result.stdout).toBe("hi\n");
    await sandbox.destroy();
    expect(calls.map((call) => call.args)).toEqual([
      ["inspect", "--type", "container", "--format", "{{.Created}}", "abc123"],
      ["exec", "abc123", "echo", "hi"],
      ["rm", "-f", "abc123"]
    ]);
  });

  test("attach to a missing container fails as a validation error and changes nothing", async () => {
    const { calls, runner } = recordingRunner(() => ({ exitCode: 1, stdout: "", stderr: "Error: No such container: ghost" }));
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner }) });
    await expect(capsule.sandbox.attach({ id: "ghost" })).rejects.toBeInstanceOf(ProviderValidationError);
    expect(calls.map((call) => call.args[0])).toEqual(["inspect"]);
  });

  test("pull: never is passed to docker create so a missing image is never fetched", async () => {
    const { calls, runner } = recordingRunner((args) =>
      args[0] === "create" ? { exitCode: 125, stdout: "", stderr: "Error: No such image: ghost:latest" } : { exitCode: 0, stdout: "", stderr: "" }
    );
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner, pull: "never" }) });
    await expect(capsule.sandbox.create({ image: "ghost:latest", name: "capsule-pull-never" })).rejects.toBeInstanceOf(ProviderValidationError);
    const create = calls.find((call) => call.args[0] === "create");
    expect(create?.args.slice(0, 7)).toEqual(["create", "--name", "capsule-pull-never", "--workdir", "/workspace", "--pull", "never"]);
    expect(calls.some((call) => call.args[0] === "pull")).toBe(false);
  });

  test("without a pull option the create arguments are unchanged", async () => {
    const { calls, runner } = recordingRunner((args) =>
      args[0] === "create" ? { exitCode: 0, stdout: "cid\n", stderr: "" } : { exitCode: 0, stdout: "", stderr: "" }
    );
    const capsule = new Capsule({ adapter: docker({ checkAvailable: async () => true, runner }) });
    await capsule.sandbox.create({ image: "node:22", name: "capsule-default-pull" });
    const create = calls.find((call) => call.args[0] === "create");
    expect(create?.args).not.toContain("--pull");
  });
});
