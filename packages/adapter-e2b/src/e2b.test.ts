import { beforeEach, describe, expect, it } from "vitest";
import { AdapterExecutionError, Capsule, CleanupFailureError, MemoryReceiptStore, ProviderAuthError, ProviderRateLimitError, runAdapterContract } from "@capsule/core";
import { e2b, e2bCapabilities } from "./e2b-adapter.js";

function failingE2B(error: Error) {
  return e2b({ sandboxClass: { create: async () => Promise.reject(error) } as never });
}

class FakeE2BSandbox {
  static createdWith: unknown[] = [];
  static instance: FakeE2BSandbox = new FakeE2BSandbox();
  sandboxId = "e2b_fake_123";
  sandboxDomain = "e2b_fake_123.e2b.dev";
  killed = false;
  commandError?: Error;
  killError?: Error;
  written = new Map<string, string | ArrayBuffer | Blob | ReadableStream>();
  commands = {
    run: async (command: string, options?: { envs?: Record<string, string> }) => {
      if (this.commandError) {
        throw this.commandError;
      }
      return {
        exitCode: 0,
        stdout: command.includes("secret") ? `value=${options?.envs?.SECRET ?? ""}` : "hello from e2b\n",
        stderr: ""
      };
    }
  };
  files = {
    write: async (path: string, data: string | ArrayBuffer | Blob | ReadableStream) => {
      this.written.set(path, data);
    },
    read: async (path: string) => {
      const value = this.written.get(path);
      return new TextEncoder().encode(typeof value === "string" ? value : "bytes");
    },
    list: async (path: string) => [{ name: "index.js", path: `${path}/index.js`, type: "file", size: 24 }]
  };
  static async create(...args: unknown[]) {
    FakeE2BSandbox.createdWith = args;
    return FakeE2BSandbox.instance;
  }
  async kill() {
    if (this.killError) {
      throw this.killError;
    }
    this.killed = true;
  }
}

function resetFakeSandbox(sandbox = new FakeE2BSandbox()) {
  FakeE2BSandbox.createdWith = [];
  FakeE2BSandbox.instance = sandbox;
  return sandbox;
}

describe("e2b adapter", () => {
  beforeEach(() => {
    resetFakeSandbox();
  });

  it("runs the shared adapter contract suite and classifies provider failures", async () => {
    const rateLimited = failingE2B(Object.assign(new Error("sandbox quota exceeded"), { name: "RateLimitError", status: 429 }));
    await runAdapterContract(rateLimited, {
      failureScenarios: [
        {
          name: "E2B rate limits surface as a retryable rate-limit provider error",
          exercise: (capsule) => capsule.sandbox.create({ image: "base" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderRateLimitError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "rate-limit", retryable: true, status: 429 } });
          }
        }
      ]
    });
  });

  it("classifies E2B authentication failures as auth provider errors", async () => {
    const capsule = new Capsule({ adapter: failingE2B(Object.assign(new Error("invalid api key"), { name: "AuthenticationError", status: 401 })) });

    let thrown: unknown;
    try {
      await capsule.sandbox.create({ image: "base" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderAuthError);
    expect((thrown as Error).message).toBe("invalid api key");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "auth", retryable: false, status: 401 } });
  });

  it("declares real sandbox capabilities", () => {
    expect(e2bCapabilities.sandbox?.create).toBe("native");
    expect(e2bCapabilities.sandbox?.exec).toBe("native");
    expect(e2bCapabilities.job?.run).toBe("unsupported");
  });

  it("creates a sandbox and maps file and exec operations", async () => {
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: e2b({ sandboxClass: FakeE2BSandbox, apiKey: "test", defaultTemplate: "base" }),
      policy: {
        network: { mode: "none" },
        limits: { timeoutMs: 1_000 }
      },
      receipts: true,
      receiptStore: store
    });

    const sandbox = await capsule.sandbox.create({ name: "test-box", cwd: "/workspace", idempotencyKey: "e2b-create-key" });
    await sandbox.writeFile("/workspace/index.js", "console.log('hi')");
    const file = await sandbox.readFile("/workspace/index.js");
    const entries = await sandbox.listFiles("/workspace");
    const result = await sandbox.exec({ command: ["node", "/workspace/index.js"] });
    await sandbox.destroy();

    expect(FakeE2BSandbox.createdWith[0]).toBe("base");
    expect(FakeE2BSandbox.createdWith[1]).toMatchObject({ allowInternetAccess: false, timeoutMs: 1_000 });
    expect(FakeE2BSandbox.createdWith[1]).toMatchObject({ metadata: { capsule_operation_scope: "sandbox_create" } });
    expect(new TextDecoder().decode(file)).toBe("console.log('hi')");
    expect(entries[0]).toMatchObject({ name: "index.js", type: "file" });
    expect(result.stdout).toBe("hello from e2b\n");
    expect(result.receipt?.provider).toBe("e2b");
    expect(store.receipts.find((receipt) => receipt.type === "sandbox.create")?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1"
    });
    expect(result.receipt?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1"
    });
    expect(FakeE2BSandbox.instance.killed).toBe(true);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual([
      "sandbox.create",
      "sandbox.file.write",
      "sandbox.file.read",
      "sandbox.file.list",
      "sandbox.exec",
      "sandbox.destroy"
    ]);
  });

  it("redacts secret values in command output", async () => {
    const capsule = new Capsule({
      adapter: e2b({ sandboxClass: FakeE2BSandbox }),
      policy: { secrets: { allowed: ["SECRET"], redactFromLogs: true } },
      receipts: true
    });
    const sandbox = await capsule.sandbox.create({});
    const result = await sandbox.exec({ command: "echo secret", env: { SECRET: "token-value" } });
    expect(result.stdout).toBe("value=[REDACTED]");
    expect(result.receipt?.stdoutHash).toBeDefined();
  });

  it("kills allocated E2B sandboxes when create fails after provider allocation", async () => {
    const allocated = resetFakeSandbox();
    const capsule = new Capsule({
      adapter: e2b({ sandboxClass: FakeE2BSandbox }),
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
      action: "kill-created-sandbox",
      sandboxId: "e2b_fake_123",
      status: "killed"
    });
    expect(allocated.killed).toBe(true);
  });

  it("kills E2B sandboxes when command execution throws before a receipt", async () => {
    const allocated = resetFakeSandbox();
    allocated.commandError = new Error("e2b exec failed");
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: e2b({ sandboxClass: FakeE2BSandbox }),
      receipts: true,
      receiptStore: store
    });
    const sandbox = await capsule.sandbox.create({});

    let thrown: unknown;
    try {
      await sandbox.exec({ command: "echo never-recorded" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("e2b exec failed");
    expect((thrown as { cleanup?: Record<string, unknown> }).cleanup).toMatchObject({
      action: "kill-sandbox-after-exec-error",
      sandboxId: "e2b_fake_123",
      status: "killed"
    });
    expect(allocated.killed).toBe(true);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("wraps the original E2B exec error when cleanup kill fails", async () => {
    const allocated = resetFakeSandbox();
    allocated.commandError = new Error("e2b exec failed");
    allocated.killError = new Error("e2b kill failed");
    const capsule = new Capsule({
      adapter: e2b({ sandboxClass: FakeE2BSandbox }),
      receipts: true
    });
    const sandbox = await capsule.sandbox.create({});

    let thrown: unknown;
    try {
      await sandbox.exec({ command: "echo cleanup-fails" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CleanupFailureError);
    expect((thrown as Error).message).toBe("E2B sandbox cleanup failed after sandbox allocation.");
    expect((thrown as { cleanup?: Record<string, unknown> }).cleanup).toMatchObject({
      action: "kill-sandbox-after-exec-error",
      sandboxId: "e2b_fake_123",
      status: "failed",
      error: "e2b kill failed"
    });
    expect((thrown as CleanupFailureError).cause).toMatchObject({
      operationError: expect.objectContaining({ message: "e2b exec failed" })
    });
    expect(allocated.killed).toBe(false);
  });
});
