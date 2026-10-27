import { describe, expect, it } from "vitest";
import {
  AdapterExecutionError,
  Capsule,
  CleanupFailureError,
  MemoryReceiptStore,
  PendingOperationError,
  PolicyViolationError,
  ProviderAuthError,
  ProviderRetryableError,
  partialEffectsOf,
  runAdapterContract,
  UnsupportedCapabilityError
} from "@capsule-sdk/core";
import { modal, modalCapabilities } from "./index.js";

function failingModal(error: Error) {
  return modal({
    client: {
      apps: { fromName: async () => ({ appId: "app-1" }) },
      images: { fromRegistry: (tag: string) => ({ tag }) },
      sandboxes: { create: async () => Promise.reject(error) }
    }
  });
}

function fakeModalSandbox() {
  const files = new Map<string, Uint8Array>();
  const sandbox: any = {
    sandboxId: "sb-1",
    terminated: false,
    terminateError: undefined as Error | undefined,
    terminateParams: [] as unknown[],
    terminateHangs: false,
    exec: async (command: string[]) => ({
      wait: async () => 0,
      stdout: { readText: async () => command.join(" ") },
      stderr: { readText: async () => "" }
    }),
    open: async (path: string) => ({
      write: async (data: Uint8Array) => {
        files.set(path, data);
      },
      read: async () => files.get(path) ?? new Uint8Array(),
      flush: async () => undefined,
      close: async () => undefined
    }),
    terminate: async (params?: unknown) => {
      sandbox.terminateParams.push(params);
      if (sandbox.terminateError) {
        throw sandbox.terminateError;
      }
      if (sandbox.terminateHangs) {
        return await new Promise(() => undefined);
      }
      sandbox.terminated = true;
      // The installed SDK resolves terminate({ wait: true }) with the sandbox exit code.
      return (params as { wait?: boolean } | undefined)?.wait ? 137 : undefined;
    }
  };
  return { sandbox, files };
}

function fakeModalClient(sandbox: any, created: unknown[] = []) {
  return {
    apps: { fromName: async () => ({ appId: "app-1" }) },
    images: { fromRegistry: (tag: string) => ({ tag }) },
    sandboxes: {
      create: async (...args: any[]) => {
        created.push(args);
        return sandbox;
      }
    }
  };
}

describe("modal adapter", () => {
  it("runs the shared adapter contract suite and classifies provider failures", async () => {
    const unavailable = failingModal(Object.assign(new Error("modal control plane unavailable"), { status: 500 }));
    await runAdapterContract(unavailable, {
      failureScenarios: [
        {
          name: "Modal control-plane faults surface as retryable provider errors",
          exercise: (capsule) => capsule.sandbox.create({ image: "debian:bookworm-slim" }),
          expectError: (error) => {
            expect(error).toBeInstanceOf(ProviderRetryableError);
            expect((error as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "retryable", retryable: true, status: 500 } });
          }
        }
      ]
    });
  });

  it("classifies Modal permission failures as auth provider errors", async () => {
    const capsule = new Capsule({ adapter: failingModal(Object.assign(new Error("token forbidden"), { name: "PermissionDenied", status: 403 })) });

    let thrown: unknown;
    try {
      await capsule.sandbox.create({ image: "debian:bookworm-slim" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderAuthError);
    expect((thrown as Error).message).toBe("token forbidden");
    expect((thrown as AdapterExecutionError).cause).toMatchObject({ providerError: { category: "auth", retryable: false, status: 403 } });
  });

  it("declares sandbox support with honest file list gap", () => {
    expect(modalCapabilities.sandbox?.create).toBe("native");
    expect(modalCapabilities.sandbox?.fileList).toBe("unsupported");
  });

  it("declares no capability that has no invocable Capsule surface", () => {
    expect(modalCapabilities.sandbox?.artifacts).toBe("unsupported");
    expect(modalCapabilities.sandbox?.streamingLogs).toBe("unsupported");
    expect(modalCapabilities.sandbox?.snapshot).toBe("unsupported");
    expect(modalCapabilities.sandbox?.exposePort).toBe("unsupported");
  });

  it("creates a sandbox and maps exec/read/write/destroy", async () => {
    const created: any[] = [];
    const { sandbox } = fakeModalSandbox();
    const client = fakeModalClient(sandbox, created);
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({
      adapter: modal({ client, appName: "capsule-test", environment: "test-env" }),
      policy: { network: { mode: "none" } },
      receipts: true,
      receiptStore: store
    });
    const box = await capsule.sandbox.create({ image: "node:22", name: "box" });
    await box.writeFile("/workspace/index.js", "console.log('hi')");
    const data = await box.readFile("/workspace/index.js");
    const result = await box.exec({ command: ["node", "/workspace/index.js"], cwd: "/workspace", timeoutMs: 5_000 });
    await expect(box.listFiles("/workspace")).rejects.toThrow(UnsupportedCapabilityError);
    await box.destroy();

    expect(created[0][2]).toMatchObject({ name: "box", blockNetwork: true });
    expect(new TextDecoder().decode(data)).toBe("console.log('hi')");
    expect(result.stdout).toContain("node");
    expect(store.receipts.find((receipt) => receipt.type === "sandbox.create")?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1",
      appName: "capsule-test",
      environment: "test-env",
      image: "node:22",
      blockNetwork: true
    });
    expect(result.receipt?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1",
      mode: "text",
      workdir: "/workspace",
      timeoutMs: 5_000
    });
    expect(store.receipts.find((receipt) => receipt.type === "sandbox.destroy")?.metadata).toMatchObject({
      runtimeVersion: process.version,
      adapterVersion: "0.1.1",
      terminateWait: true,
      exitCode: 137
    });
    expect(sandbox.terminateParams).toEqual([{ wait: true }]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual([
      "sandbox.create",
      "sandbox.file.write",
      "sandbox.file.read",
      "sandbox.exec",
      "sandbox.destroy"
    ]);
  });

  it("rejects unsupported Modal operations before provider calls", async () => {
    const created: any[] = [];
    const { sandbox } = fakeModalSandbox();
    const client = fakeModalClient(sandbox, created);
    const capsule = new Capsule({ adapter: modal({ client }) });
    const box = await capsule.sandbox.create({});

    await expect(box.listFiles("/workspace")).rejects.toThrow(UnsupportedCapabilityError);
    await expect(capsule.job.run({ image: "node:22", command: "echo unsupported" })).rejects.toThrow(UnsupportedCapabilityError);
    expect(created).toHaveLength(1);
  });

  it("reports a failed rollback with the residual sandbox when termination fails after allocation", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.terminateError = new Error("modal terminate failed");
    const capsule = new Capsule({
      adapter: modal({ client: fakeModalClient(sandbox) }),
      receipts: true,
      receiptSigner: {
        algorithm: "test",
        sign: () => {
          throw new Error("sign failed");
        }
      }
    });

    const error = await capsule.sandbox.create({}).then(
      () => undefined,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(CleanupFailureError);
    const effects = partialEffectsOf(error)!;
    expect((effects.primaryError as Error).message).toBe("sign failed");
    expect(effects.cleanup).toMatchObject({ status: "failed", residual: [expect.objectContaining({ nativeId: "sb-1" })] });
    expect((effects.cleanup.error as Error).message).toBe("modal terminate failed");
  });

  it("rejects destroy as pending when termination is requested but not observed before the deadline", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.terminateHangs = true;
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client: fakeModalClient(sandbox), terminateDeadlineMs: 20 }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    const error = await box.destroy().then(
      () => undefined,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(PendingOperationError);
    expect((error as PendingOperationError).operation).toBe("sandbox.destroy");
    expect((error as PendingOperationError).resource).toMatchObject({ provider: "modal", kind: "sandbox", nativeId: "sb-1" });
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("propagates Modal sandbox destroy failures without writing destroy receipts", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.terminateError = new Error("modal terminate failed");
    const client = fakeModalClient(sandbox);
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    await expect(box.destroy()).rejects.toThrow("modal terminate failed");

    expect(sandbox.terminated).toBe(false);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });
  it("GAP-03: rejects a domain allowlist entry before resolving the app or creating a sandbox", async () => {
    const created: unknown[] = [];
    const { sandbox } = fakeModalSandbox();
    const client = fakeModalClient(sandbox, created);
    let appLookups = 0;
    client.apps.fromName = async () => {
      appLookups += 1;
      return { appId: "app-1" };
    };
    const capsule = new Capsule({ adapter: modal({ client }), policy: { network: { mode: "allowlist", allowedHosts: ["api.example.com"] } } });

    await expect(capsule.sandbox.create({})).rejects.toBeInstanceOf(PolicyViolationError);
    expect(appLookups).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("GAP-03: maps CIDR allowlists to cidrAllowlist and an empty allowlist to blockNetwork", async () => {
    const created: any[] = [];
    const { sandbox } = fakeModalSandbox();
    const client = fakeModalClient(sandbox, created);
    await new Capsule({ adapter: modal({ client }), policy: { network: { mode: "allowlist", allowedHosts: ["192.0.2.0/24"] } } }).sandbox.create({});
    await new Capsule({ adapter: modal({ client }), policy: { network: { mode: "allowlist" } } }).sandbox.create({});

    expect(created[0][2]).toMatchObject({ cidrAllowlist: ["192.0.2.0/24"] });
    expect(created[0][2].blockNetwork).toBeUndefined();
    expect(created[1][2]).toMatchObject({ blockNetwork: true });
    expect(created[1][2].cidrAllowlist).toBeUndefined();
  });
});
