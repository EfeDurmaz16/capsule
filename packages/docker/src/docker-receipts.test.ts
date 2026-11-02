import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule-sdk/core";
import { docker } from "./docker-adapter.js";
import { runDocker } from "./docker-cli.js";

vi.mock("./docker-cli.js", () => ({
  dockerAvailable: vi.fn(async () => true),
  runDocker: vi.fn(async (args: string[]) => {
    const [command] = args;
    if (command === "create") {
      return { exitCode: 0, stdout: "container-123\n", stderr: "" };
    }
    if (command === "start" || command === "rm") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "cp") {
      const destination = args[2];
      if (destination && !destination.includes(":")) {
        await writeFile(destination, "hello");
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "exec" && args.includes("mkdir")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (command === "exec" && args[2] === "find" && args[3] === "/workspace") {
      // find -printf '%f\0%p\0%y\0%s\0' emits NUL-separated fields.
      return { exitCode: 0, stdout: "hello.txt\0/workspace/hello.txt\0f\x005\0", stderr: "" };
    }
    if (command === "exec") {
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: `unexpected docker args: ${args.join(" ")}` };
  })
}));

const runDockerMock = vi.mocked(runDocker);

describe("docker sandbox receipts", () => {
  beforeEach(() => {
    runDockerMock.mockClear();
  });

  test("records governed receipts for Docker sandbox sub-operations", async () => {
    const receiptStore = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: docker(), receipts: true, receiptStore });

    const sandbox = await capsule.sandbox.create({ image: "node:22", name: "capsule-receipts" });
    await sandbox.writeFile("/workspace/hello.txt", "hello");
    const file = await sandbox.readFile("/workspace/hello.txt");
    const entries = await sandbox.listFiles("/workspace");
    const exec = await sandbox.exec({ command: ["echo", "ok"] });
    await sandbox.destroy();

    expect(new TextDecoder().decode(file)).toBe("hello");
    expect(entries).toEqual([{ name: "hello.txt", path: "/workspace/hello.txt", type: "file", sizeBytes: 5 }]);
    expect(exec.stdout).toBe("ok\n");
    expect(receiptStore.receipts.map((receipt) => receipt.type)).toEqual([
      "sandbox.create",
      "sandbox.file.write",
      "sandbox.file.read",
      "sandbox.file.list",
      "sandbox.exec",
      "sandbox.destroy"
    ]);
    expect(receiptStore.receipts.map((receipt) => receipt.capabilityPath)).toEqual([
      "sandbox.create",
      "sandbox.fileWrite",
      "sandbox.fileRead",
      "sandbox.fileList",
      "sandbox.exec",
      "sandbox.destroy"
    ]);
    expect(receiptStore.receipts[1]?.metadata).toMatchObject({ path: "/workspace/hello.txt", byteLength: 5 });
    expect(receiptStore.receipts[2]?.metadata).toMatchObject({ path: "/workspace/hello.txt", byteLength: 5 });
    expect(receiptStore.receipts[3]?.metadata).toMatchObject({ path: "/workspace", entryCount: 1 });
    expect(receiptStore.receipts[4]).toBe(exec.receipt);
    expect(receiptStore.receipts[4]?.resource).toMatchObject({ id: "container-123", status: "running" });
    expect(receiptStore.receipts[5]?.resource).toMatchObject({ id: "container-123", status: "deleted" });
  });
});
