import { describe, expect, it } from "vitest";
import { assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule, MemoryReceiptStore } from "@capsule/core";
import { e2b, e2bCapabilities } from "./e2b-adapter.js";

class FakeE2BSandbox {
  static createdWith: unknown[] = [];
  static instance = new FakeE2BSandbox();
  sandboxId = "e2b_fake_123";
  sandboxDomain = "e2b_fake_123.e2b.dev";
  killed = false;
  written = new Map<string, string | ArrayBuffer | Blob | ReadableStream>();
  commands = {
    run: async (command: string, options?: { envs?: Record<string, string> }) => ({
      exitCode: 0,
      stdout: command.includes("secret") ? `value=${options?.envs?.SECRET ?? ""}` : "hello from e2b\n",
      stderr: ""
    })
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
    this.killed = true;
  }
}

describe("e2b adapter", () => {
  it("declares real sandbox capabilities", () => {
    expect(e2bCapabilities.sandbox?.create).toBe("native");
    expect(e2bCapabilities.sandbox?.exec).toBe("native");
    expect(e2bCapabilities.job?.run).toBe("unsupported");
  });

  it("satisfies the public adapter contract", async () => {
    const adapter = e2b({ sandboxClass: FakeE2BSandbox });
    assertAdapterContract(adapter);
    await assertUnsupportedCapabilitiesReject(adapter);
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

    const sandbox = await capsule.sandbox.create({ name: "test-box", cwd: "/workspace" });
    await sandbox.writeFile("/workspace/index.js", "console.log('hi')");
    const file = await sandbox.readFile("/workspace/index.js");
    const entries = await sandbox.listFiles("/workspace");
    const result = await sandbox.exec({ command: ["node", "/workspace/index.js"] });
    await sandbox.destroy();

    expect(FakeE2BSandbox.createdWith[0]).toBe("base");
    expect(FakeE2BSandbox.createdWith[1]).toMatchObject({ allowInternetAccess: false, timeoutMs: 1_000 });
    expect(new TextDecoder().decode(file)).toBe("console.log('hi')");
    expect(entries[0]).toMatchObject({ name: "index.js", type: "file" });
    expect(result.stdout).toBe("hello from e2b\n");
    expect(result.receipt?.provider).toBe("e2b");
    expect(FakeE2BSandbox.instance.killed).toBe(true);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.destroy"]);
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
});
