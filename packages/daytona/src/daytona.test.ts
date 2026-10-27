import { describe, expect, it } from "vitest";
import {
  AdapterExecutionError,
  Capsule,
  CleanupFailureError,
  MemoryReceiptStore,
  ProviderRetryableError,
  ProviderValidationError,
  UnknownOutcomeError,
  runAdapterContract
} from "@capsule-sdk/core";
import { daytona, daytonaCapabilities } from "./index.js";

function failingDaytona(error: Error) {
  return daytona({ client: { create: async () => Promise.reject(error) } });
}

function fakeDaytonaSandbox() {
  const files = new Map<string, Buffer>();
  const sandbox: any = {
    id: "sandbox-1",
    name: "box",
    state: "started",
    createdAt: "2026-05-12T00:00:00.000Z",
    deleted: false,
    commandError: undefined as Error | undefined,
    deleteError: undefined as Error | undefined,
    process: {
      executeCommand: async (command: string) => {
        if (sandbox.commandError) {
          throw sandbox.commandError;
        }
        return { exitCode: 0, result: `ran ${command}` };
      }
    },
    fs: {
      uploadFile: async (data: Buffer, path: string) => {
        files.set(path, data);
      },
      downloadFile: async (path: string) => files.get(path) ?? Buffer.from(""),
      // Exact FileInfo shape of the installed @daytona/toolbox-api-client: no path field.
      listFiles: async () => [
        { group: "daytona", isDir: false, modTime: "", mode: "-rw-r--r--", name: "index.js", owner: "daytona", permissions: "0644", size: 20 },
        { group: "daytona", isDir: true, modTime: "", mode: "drwxr-xr-x", name: "lib", owner: "daytona", permissions: "0755", size: 4096 }
      ]
    },
    delete: async () => {
      if (sandbox.deleteError) {
        throw sandbox.deleteError;
      }
      sandbox.deleted = true;
    }
  };
  return { sandbox, files };
}

describe("daytona adapter", () => {
  it("runs the shared adapter contract suite and classifies provider failures", async () => {
    const unavailable = failingDaytona(Object.assign(new Error("daytona is temporarily unavailable"), { statusCode: 503 }));
    await runAdapterContract(unavailable, {
      failureScenarios: [
        {
          name: "Daytona service outages surface as retryable provider errors",
          exercise: (capsule) => capsule.sandbox.create({ image: "node:22" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderRetryableError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "retryable", retryable: true, status: 503 } });
          }
        }
      ]
    });
  });

  it("classifies Daytona bad requests as validation provider errors", async () => {
    const capsule = new Capsule({ adapter: failingDaytona(Object.assign(new Error("invalid sandbox image"), { statusCode: 400 })) });

    let thrown: unknown;
    try {
      await capsule.sandbox.create({ image: "node:22" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderValidationError);
    expect((thrown as Error).message).toBe("invalid sandbox image");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "validation", retryable: false, status: 400 } });
  });

  it("declares sandbox capabilities as native", () => {
    expect(daytonaCapabilities.sandbox?.create).toBe("native");
    expect(daytonaCapabilities.sandbox?.exec).toBe("native");
  });

  it("declares no capability that has no invocable Capsule surface", () => {
    expect(daytonaCapabilities.sandbox?.artifacts).toBe("unsupported");
    expect(daytonaCapabilities.sandbox?.snapshot).toBe("unsupported");
    expect(daytonaCapabilities.sandbox?.exposePort).toBe("unsupported");
  });

  it("creates a sandbox and maps exec/files/destroy", async () => {
    const createdWith: any[] = [];
    const { sandbox } = fakeDaytonaSandbox();
    const client = {
      create: async (...args: any[]) => {
        createdWith.push(...args);
        return sandbox;
      }
    };
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: daytona({ client, ephemeral: true }),
      policy: { network: { mode: "none" } },
      receipts: true,
      receiptStore: store
    });

    const box = await capsule.sandbox.create({ image: "node:22", name: "box", env: { NODE_ENV: "test" }, idempotencyKey: "daytona-create-key" });
    await box.writeFile("/workspace/index.js", "console.log('hi')");
    const data = await box.readFile("/workspace/index.js");
    const entries = await box.listFiles("/workspace");
    const roundTrip = await box.readFile(entries[0]!.path);
    const result = await box.exec({ command: ["node", "/workspace/index.js"] });
    await box.destroy();

    expect(createdWith[0]).toMatchObject({ image: "node:22", name: "box", networkBlockAll: true, ephemeral: true });
    expect(createdWith[0]).toMatchObject({ labels: { capsule_operation_scope: "sandbox_create" } });
    expect(new TextDecoder().decode(data)).toBe("console.log('hi')");
    expect(entries).toEqual([
      { name: "index.js", path: "/workspace/index.js", type: "file", sizeBytes: 20 },
      { name: "lib", path: "/workspace/lib", type: "directory", sizeBytes: 4096 }
    ]);
    expect(new TextDecoder().decode(roundTrip)).toBe("console.log('hi')");
    expect(result.stdout).toContain("node");
    expect(store.receipts.find((receipt) => receipt.type === "sandbox.create")?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1"
    });
    expect(result.receipt?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1"
    });
    expect(store.receipts.map((receipt) => receipt.type)).toEqual([
      "sandbox.create",
      "sandbox.file.write",
      "sandbox.file.read",
      "sandbox.file.list",
      "sandbox.file.read",
      "sandbox.exec",
      "sandbox.destroy"
    ]);
  });

  it("deletes allocated Daytona sandboxes when create fails after provider allocation", async () => {
    const { sandbox } = fakeDaytonaSandbox();
    const client = { create: async () => sandbox };
    const capsule = new Capsule({
      adapter: daytona({ client }),
      receipts: true,
      receiptSigner: {
        algorithm: "test-signature",
        sign: () => {
          throw new Error("receipt signing failed");
        }
      }
    });

    let thrown: unknown;
    try {
      await capsule.sandbox.create({ name: "cleanup-after-create" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("receipt signing failed");
    expect((thrown as { cleanup?: Record<string, unknown> }).cleanup).toMatchObject({
      action: "delete-created-sandbox",
      sandboxId: "sandbox-1",
      status: "deleted"
    });
    expect(sandbox.deleted).toBe(true);
  });

  it("GAP-02: keeps the sandbox and reports an unknown outcome when exec transport fails", async () => {
    const { sandbox } = fakeDaytonaSandbox();
    sandbox.commandError = new Error("daytona exec failed");
    const store = new MemoryReceiptStore();
    const client = { create: async () => sandbox };
    const capsule = new Capsule({ adapter: daytona({ client }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    const thrown = await box.exec({ command: "echo never-recorded" }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(UnknownOutcomeError);
    expect((thrown as UnknownOutcomeError).retrySafe).toBe(false);
    expect((thrown as UnknownOutcomeError).resource).toMatchObject({ provider: "daytona", kind: "sandbox", nativeId: "sandbox-1" });
    expect(((thrown as UnknownOutcomeError).cause as Error).message).toBe("daytona exec failed");
    expect(sandbox.deleted).toBe(false);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("GAP-02: returns a refused exec as a typed provider error and keeps the sandbox", async () => {
    const { sandbox } = fakeDaytonaSandbox();
    sandbox.commandError = Object.assign(new Error("bad request"), { status: 400 });
    const capsule = new Capsule({ adapter: daytona({ client: { create: async () => sandbox } }) });
    const box = await capsule.sandbox.create({});

    await expect(box.exec({ command: "echo refused" })).rejects.toBeInstanceOf(ProviderValidationError);
    expect(sandbox.deleted).toBe(false);
  });

  it("GAP-02: a nonzero exit is an ordinary result and keeps the sandbox", async () => {
    const { sandbox } = fakeDaytonaSandbox();
    sandbox.process.executeCommand = async () => ({ exitCode: 3, result: "tests failed" });
    const capsule = new Capsule({ adapter: daytona({ client: { create: async () => sandbox } }), receipts: true });
    const box = await capsule.sandbox.create({});

    const result = await box.exec({ command: "npm test" });

    expect(result).toMatchObject({ exitCode: 3, stdout: "tests failed" });
    expect(result.receipt?.exitCode).toBe(3);
    expect(sandbox.deleted).toBe(false);
  });
});
