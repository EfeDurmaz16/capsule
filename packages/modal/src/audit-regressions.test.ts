// Audit regressions for the M1 campaign (Modal sandbox). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The client is an injected fake shaped like
// the installed modal SDK, whose Sandbox.terminate({ wait: true }) resolves with the exit code.
import { describe, expect, it } from "vitest";
import { Capsule, MemoryReceiptStore } from "@capsule-sdk/core";
import { modal } from "./index.js";

function fakeModal() {
  const state: { terminateCalls: Array<{ wait?: boolean } | undefined>; terminated: boolean } = { terminateCalls: [], terminated: false };
  const sandbox = {
    sandboxId: "audit-modal",
    terminate: async (params?: { wait?: boolean }) => {
      state.terminateCalls.push(params);
      if (params?.wait === true) {
        state.terminated = true;
        return 0;
      }
      return undefined;
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
      sandboxes: { create: async () => sandbox }
    } as never
  });
  return { state, adapter };
}

describe("M1 audit regressions: modal", () => {
  it.fails("SB-05: a receipt signer failure after allocation attempts termination and keeps the original error", async () => {
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

  it("SB-06: destroy observes terminal termination (wait: true) before writing a deleted receipt", async () => {
    const fake = fakeModal();
    const store = new MemoryReceiptStore();
    const box = await new Capsule({ adapter: fake.adapter, receipts: true, receiptStore: store }).sandbox.create({});
    await box.destroy();
    expect(fake.state.terminateCalls.at(-1)?.wait).toBe(true);
    expect(fake.state.terminated).toBe(true);
    expect(store.receipts.at(-1)?.resource?.status).toBe("deleted");
  });

  it.fails("SB-10c: sandbox.artifacts is not claimed unless artifactPaths are actually collected", async () => {
    const capsule = new Capsule({ adapter: fakeModal().adapter });
    if (!capsule.supports("sandbox.artifacts")) return;
    const box = await capsule.sandbox.create({});
    const result = await box.exec({ command: "true", artifactPaths: ["/workspace/out.txt"] });
    expect(result.artifacts).toHaveLength(1);
  });
});
