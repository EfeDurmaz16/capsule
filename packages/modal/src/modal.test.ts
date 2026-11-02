import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdapterExecutionError,
  Capsule,
  CleanupFailureError,
  MemoryReceiptStore,
  PendingOperationError,
  PolicyViolationError,
  ProviderAuthError,
  ProviderRetryableError,
  PartialEffectsError,
  partialEffectsOf,
  runAdapterContract,
  UnknownOutcomeError,
  UnsupportedCapabilityError
} from "@capsule-sdk/core";
import { modal, modalCapabilities } from "./index.js";

afterEach(() => {
  vi.useRealTimers();
});

function failingModal(error: Error) {
  return modal({
    client: {
      apps: { fromName: async () => ({ appId: "app-1" }) },
      images: { fromRegistry: (tag: string) => ({ tag }) },
      sandboxes: {
        create: async () => Promise.reject(error),
        fromId: async () => {
          throw new Error("unused");
        }
      }
    }
  });
}

// Shaped like the installed modal SDK: terminate() sends one request and detaches the handle it was called
// on (poll() then throws), sandboxes.fromId() returns a fresh handle, and poll() returns null while the
// sandbox runs, else its exit code. `calls` records every provider RPC in order.
function fakeModalSandbox() {
  const files = new Map<string, Uint8Array>();
  const sandbox: any = {
    sandboxId: "sb-1",
    terminated: false,
    terminateError: undefined as Error | undefined,
    terminateParams: [] as unknown[],
    terminateHangs: false,
    // Exit code poll() reports once the terminate request was received; null keeps the sandbox running.
    exitCode: 137 as number | null,
    // Scripted poll() answers consumed before exitCode applies.
    pollResults: [] as Array<number | null>,
    calls: [] as string[],
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
      sandbox.calls.push("terminate");
      sandbox.terminateParams.push(params);
      if (sandbox.terminateError) {
        throw sandbox.terminateError;
      }
      if (sandbox.terminateHangs) {
        return await new Promise(() => undefined);
      }
      sandbox.terminated = true;
      return undefined;
    },
    poll: async () => {
      sandbox.calls.push("poll:detached");
      throw new Error("Sandbox is detached");
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
      },
      fromId: async (sandboxId: string) => {
        sandbox.calls.push("fromId");
        return {
          sandboxId,
          poll: async () => {
            sandbox.calls.push("poll");
            if (sandbox.pollResults.length > 0) return sandbox.pollResults.shift();
            return sandbox.terminated ? sandbox.exitCode : null;
          }
        };
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
      polls: 1,
      exitCode: 137
    });
    // One terminate request without wait, then the fresh fromId handle is polled, never the detached one.
    expect(sandbox.terminateParams).toEqual([undefined]);
    expect(sandbox.calls).toEqual(["terminate", "fromId", "poll"]);
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

  it("rejects destroy as pending when the terminate request was answered but the sandbox is still running at the deadline", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.exitCode = null;
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
    expect((error as PendingOperationError).state).toBe("running");
    expect(sandbox.calls.slice(0, 3)).toEqual(["terminate", "fromId", "poll"]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("rejects destroy with an unknown outcome when the terminate request is not answered before the deadline", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.terminateHangs = true;
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client: fakeModalClient(sandbox), terminateDeadlineMs: 20 }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    const error = await box.destroy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect(error).toMatchObject({ operation: "sandbox.destroy", resource: { provider: "modal", kind: "sandbox", nativeId: "sb-1" } });
    expect((error as UnknownOutcomeError).cause).toBeInstanceOf(PendingOperationError);
    expect(sandbox.calls).toEqual(["terminate"]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("returns the exit code of a sandbox that exits during polling", async () => {
    vi.useFakeTimers();
    const { sandbox } = fakeModalSandbox();
    sandbox.pollResults = [null, null, 1];
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client: fakeModalClient(sandbox) }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    const destroyed = box.destroy();
    await vi.advanceTimersByTimeAsync(2_500);
    await destroyed;

    expect(sandbox.calls).toEqual(["terminate", "fromId", "poll", "poll", "poll"]);
    expect(store.receipts.at(-1)).toMatchObject({ type: "sandbox.destroy", resource: { status: "deleted" }, metadata: { exitCode: 1, polls: 3 } });
  });

  it("propagates Modal sandbox destroy failures without writing destroy receipts", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.terminateError = Object.assign(new Error("modal terminate failed"), { status: 503 });
    const client = fakeModalClient(sandbox);
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    const error = await box.destroy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderRetryableError);
    expect((error as Error).message).toBe("modal terminate failed");
    expect(sandbox.terminated).toBe(false);
    expect(sandbox.calls).toEqual(["terminate"]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  // The SDK's client retries a transient status three times and then rejects with the final gRPC status.
  // CANCELLED (1), UNKNOWN (2), DEADLINE_EXCEEDED (4) and UNAVAILABLE (14) mean the terminate request got
  // no answer: Modal may have received it, so the outcome is unknown, not a failed termination.
  it.each([1, 2, 4, 14])("rejects destroy with an unknown outcome when the SDK gives up on the terminate request with gRPC status %i", async (code) => {
    const { sandbox } = fakeModalSandbox();
    sandbox.terminateError = Object.assign(new Error(`/modal.client.ModalClient/SandboxTerminate status ${code}`), { code });
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: modal({ client: fakeModalClient(sandbox) }), receipts: true, receiptStore: store }).sandbox.create({});

    const error = await box.destroy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect(error).toMatchObject({ operation: "sandbox.destroy", resource: expect.objectContaining({ nativeId: "sb-1" }) });
    expect((error as UnknownOutcomeError).cause).toMatchObject({ message: `/modal.client.ModalClient/SandboxTerminate status ${code}` });
    expect(sandbox.calls).toEqual(["terminate"]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("rejects destroy with the classified provider error when Modal refuses the terminate request", async () => {
    const { sandbox } = fakeModalSandbox();
    // PERMISSION_DENIED (7): an answer, so the outcome is known.
    sandbox.terminateError = Object.assign(new Error("/modal.client.ModalClient/SandboxTerminate PERMISSION_DENIED: no"), { code: 7 });
    const box = await new Capsule({ adapter: modal({ client: fakeModalClient(sandbox) }) }).sandbox.create({});
    const error = await box.destroy().catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(UnknownOutcomeError);
    expect(error).toBeInstanceOf(ProviderAuthError);
    expect(sandbox.calls).toEqual(["terminate"]);
  });

  it("reports a failed poll after an accepted terminate request as pending, not as a termination failure", async () => {
    const { sandbox } = fakeModalSandbox();
    const client = fakeModalClient(sandbox);
    client.sandboxes.fromId = async () => {
      throw new Error("sandboxWait unavailable");
    };
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: modal({ client }), receipts: true, receiptStore: store }).sandbox.create({});

    const error = await box.destroy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PendingOperationError);
    expect((error as PendingOperationError).cause).toMatchObject({ message: "sandboxWait unavailable" });
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
  it("GAP-04: writes exec input to the process stdin and closes it for EOF", async () => {
    const { sandbox } = fakeModalSandbox();
    const stdinEvents: string[] = [];
    sandbox.exec = async () => ({
      stdin: {
        writeText: async (text: string) => {
          stdinEvents.push(`write:${text}`);
        },
        close: async () => {
          stdinEvents.push("close");
        }
      },
      wait: async () => 0,
      stdout: { readText: async () => stdinEvents.join(",") },
      stderr: { readText: async () => "" }
    });
    const box = await new Capsule({ adapter: modal({ client: fakeModalClient(sandbox) }) }).sandbox.create({});

    const withInput = await box.exec({ command: ["cat"], input: "hello" });
    expect(withInput.stdout).toBe("write:hello,close");
    stdinEvents.length = 0;
    const emptyInput = await box.exec({ command: ["cat"], input: "" });
    expect(emptyInput.stdout).toBe("close");
    stdinEvents.length = 0;
    const noInput = await box.exec({ command: ["true"] });
    expect(noInput.stdout).toBe("");
  });

  it("GAP-04: a failed stdin delivery reports an unknown command outcome", async () => {
    const { sandbox } = fakeModalSandbox();
    sandbox.exec = async () => ({
      stdin: {
        writeText: async () => {
          throw new Error("stream reset");
        },
        close: async () => undefined
      },
      wait: async () => 0,
      stdout: { readText: async () => "" },
      stderr: { readText: async () => "" }
    });
    const box = await new Capsule({ adapter: modal({ client: fakeModalClient(sandbox) }) }).sandbox.create({});

    await expect(box.exec({ command: ["cat"], input: "hello" })).rejects.toBeInstanceOf(UnknownOutcomeError);
  });
});

// The installed modal SDK's terminate, poll and sandboxes.fromId take no AbortSignal or timeout, so a call in
// flight at terminateDeadlineMs cannot be cancelled. The deadline must still end the wait, no RPC may start
// after it, and the late answer of the one call that outlives it must change nothing.
describe("modal termination that outlives the deadline", () => {
  function lateTerminatingSandbox() {
    const { sandbox } = fakeModalSandbox();
    const settle: { resolve?: () => void; reject?: (error: Error) => void } = {};
    sandbox.terminate = (params?: unknown) => {
      sandbox.calls.push("terminate");
      sandbox.terminateParams.push(params);
      return new Promise<void>((resolve, reject) => Object.assign(settle, { resolve, reject }));
    };
    return { sandbox, settle };
  }
  const later = () => new Promise((resolve) => setTimeout(resolve, 30));

  it.each([
    { outcome: "resolves", finish: (settle: any) => settle.resolve() },
    { outcome: "rejects", finish: (settle: any) => settle.reject(new Error("modal terminate failed later")) }
  ])("an unanswered terminate request is an unknown outcome, and no RPC starts when it later $outcome", async ({ finish }) => {
    const { sandbox, settle } = lateTerminatingSandbox();
    const store = new MemoryReceiptStore();
    const capsule = new Capsule({ adapter: modal({ client: fakeModalClient(sandbox), terminateDeadlineMs: 20 }), receipts: true, receiptStore: store });
    const box = await capsule.sandbox.create({});

    const error = await box.destroy().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).cause).toMatchObject({ operation: "sandbox.destroy", deadlineMs: 20, observations: 1 });
    expect(sandbox.calls).toEqual(["terminate"]);

    finish(settle);
    await later();
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
    expect(sandbox.calls).toEqual(["terminate"]);
  });

  it("a poll in flight at the deadline is the only RPC that outlives it, and its late exit code writes no receipt", async () => {
    const { sandbox } = fakeModalSandbox();
    const client = fakeModalClient(sandbox);
    let answerPoll: ((exitCode: number) => void) | undefined;
    client.sandboxes.fromId = async (sandboxId: string) => {
      sandbox.calls.push("fromId");
      return {
        sandboxId,
        poll: () => {
          sandbox.calls.push("poll");
          return new Promise<number>((resolve) => {
            answerPoll = resolve;
          });
        }
      };
    };
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: modal({ client, terminateDeadlineMs: 20 }), receipts: true, receiptStore: store }).sandbox.create({});

    const error = await box.destroy().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PendingOperationError);
    expect(sandbox.calls).toEqual(["terminate", "fromId", "poll"]);

    answerPoll?.(137);
    await later();
    expect(sandbox.calls).toEqual(["terminate", "fromId", "poll"]);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it("no poll starts after the deadline while the sandbox keeps running", async () => {
    vi.useFakeTimers();
    const { sandbox } = fakeModalSandbox();
    sandbox.exitCode = null;
    const store = new MemoryReceiptStore();
    const box = await new Capsule({
      adapter: modal({ client: fakeModalClient(sandbox), terminateDeadlineMs: 2_500 }),
      receipts: true,
      receiptStore: store
    }).sandbox.create({});

    const destroyed = box.destroy().catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(2_500);
    const error = await destroyed;
    expect(error).toBeInstanceOf(PendingOperationError);
    const calls = [...sandbox.calls];
    expect(calls).toEqual(["terminate", "fromId", "poll", "poll", "poll"]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sandbox.calls).toEqual(calls);
    expect(store.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create"]);
  });

  it.each([
    { outcome: "unanswered terminate request", status: "unknown", setup: (sandbox: any) => (sandbox.terminateHangs = true) },
    {
      outcome: "terminate request the SDK gave up on",
      status: "unknown",
      setup: (sandbox: any) =>
        (sandbox.terminateError = Object.assign(new Error("/modal.client.ModalClient/SandboxTerminate UNAVAILABLE: later"), { code: 14 }))
    },
    { outcome: "sandbox still running", status: "pending", setup: (sandbox: any) => (sandbox.exitCode = null) }
  ])("a create rollback with an $outcome at the deadline reports cleanup as $status and stays so", async ({ status, setup }) => {
    const { sandbox } = fakeModalSandbox();
    setup(sandbox);
    const capsule = new Capsule({
      adapter: modal({ client: fakeModalClient(sandbox), terminateDeadlineMs: 20 }),
      receipts: true,
      receiptSigner: {
        algorithm: "test",
        sign: () => {
          throw new Error("sign failed");
        }
      }
    });
    const error = await capsule.sandbox.create({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialEffectsError);
    const effects = partialEffectsOf(error)!;
    expect((effects.primaryError as Error).message).toBe("sign failed");
    expect(effects.cleanup).toMatchObject({ status, residual: [expect.objectContaining({ nativeId: "sb-1" })] });
    const calls = [...sandbox.calls];

    sandbox.exitCode = 137;
    await later();
    expect(effects.cleanup.status).toBe(status);
    expect(sandbox.calls).toEqual(calls);
  });
});
