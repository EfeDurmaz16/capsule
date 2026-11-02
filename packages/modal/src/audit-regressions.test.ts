// Audit regressions for the M1 campaign (Modal sandbox). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The client is an injected fake shaped like
// the installed modal SDK: terminate() sends one request and detaches the handle, sandboxes.fromId() returns
// a fresh handle and poll() reports the exit code once the sandbox stopped.
import { describe, expect, it } from "vitest";
import { Capsule, MemoryReceiptStore, PartialEffectsError, partialEffectsOf } from "@capsule-sdk/core";
import { modal } from "./index.js";

function fakeModal() {
  const state: { terminateCalls: Array<{ wait?: boolean } | undefined>; terminated: boolean; polled: number } = {
    terminateCalls: [],
    terminated: false,
    polled: 0
  };
  const sandbox = {
    sandboxId: "audit-modal",
    terminate: async (params?: { wait?: boolean }) => {
      state.terminateCalls.push(params);
      state.terminated = true;
    },
    poll: async () => {
      throw new Error("Sandbox is detached");
    },
    exec: async () => ({ wait: async () => 0, stdout: { readText: async () => "" }, stderr: { readText: async () => "" } }),
    open: async () => {
      throw new Error("unused");
    }
  };
  const adapter = modal({
    client: {
      apps: { fromName: async () => ({ appId: "audit-app" }) },
      images: { fromRegistry: () => ({}) },
      sandboxes: {
        create: async () => sandbox,
        fromId: async (sandboxId: string) => ({
          sandboxId,
          poll: async () => {
            state.polled += 1;
            return state.terminated ? 0 : null;
          }
        })
      }
    } as never
  });
  return { state, adapter };
}

describe("M1 audit regressions: modal", () => {
  it("SB-05: a receipt signer failure after allocation attempts termination and keeps the original error", async () => {
    const fake = fakeModal();
    const capsule = new Capsule({
      adapter: fake.adapter,
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
      (caught: Error) => caught
    );
    expect(`${error?.message} ${String((error as { cause?: unknown } | undefined)?.cause)}`).toContain("sign failed");
    expect(fake.state.terminateCalls.length).toBeGreaterThan(0);
  });

  it("SB-05: the rollback outcome is recorded separately from the signer error", async () => {
    const fake = fakeModal();
    const capsule = new Capsule({
      adapter: fake.adapter,
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
    expect(error).toBeInstanceOf(PartialEffectsError);
    const effects = partialEffectsOf(error)!;
    expect((effects.primaryError as Error).message).toBe("sign failed");
    expect(effects.cleanup.status).toBe("succeeded");
    expect(effects.resources[0]).toMatchObject({ provider: "modal", kind: "sandbox", nativeId: "audit-modal" });
    expect(fake.state.terminateCalls).toEqual([undefined]);
    expect(fake.state.terminated).toBe(true);
    expect(fake.state.polled).toBe(1);
  });

  it("SB-06: destroy observes terminal termination (poll reports an exit code) before writing a deleted receipt", async () => {
    const fake = fakeModal();
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store }).sandbox.create({});
    await box.destroy();
    expect(fake.state.terminateCalls).toEqual([undefined]);
    expect(fake.state.terminated).toBe(true);
    expect(fake.state.polled).toBe(1);
    expect(store.receipts.at(-1)?.resource?.status).toBe("deleted");
  });

  it("SB-10c: sandbox.artifacts is not claimed unless artifactPaths are actually collected", async () => {
    const capsule = new Capsule({ adapter: fakeModal().adapter });
    if (!capsule.supports("sandbox.artifacts")) return;
    const box = await capsule.sandbox.create({});
    const result = await box.exec({ command: "true", artifactPaths: ["/workspace/out.txt"] });
    expect(result.artifacts).toHaveLength(1);
  });
});
