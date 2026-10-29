import { describe, expect, test } from "vitest";
import { Capsule, MemoryReceiptStore, type AdapterContext, type CapsuleAdapter } from "./index.js";

// Capsule instances share one AsyncLocalStorage for operation context. Each instance must still see
// only its own innermost operation, as it did with a storage per instance, including when one
// instance's operation runs inside another's.

const capabilities = {
  job: { run: "native", status: "native", cancel: "native", logs: "native", artifacts: "native", timeout: "native", env: "native" }
} as const;

function jobAdapter(name: string, run: (context: AdapterContext) => Promise<void>): CapsuleAdapter {
  return {
    name,
    provider: name,
    capabilities,
    job: {
      run: async (_spec, context) => {
        await run(context);
        return { id: `${name}-job`, provider: name, status: "succeeded" };
      }
    }
  };
}

describe("operation context across Capsule instances", () => {
  test("an outer instance's context stays its own while an inner instance runs an operation", async () => {
    const innerStore = new MemoryReceiptStore();
    const outerStore = new MemoryReceiptStore();
    let outerContext: AdapterContext | undefined;
    const inner = new Capsule({
      adapter: jobAdapter("inner", async (context) => {
        // The outer adapter's context, used while only the inner operation is innermost.
        outerContext!.createReceipt({ type: "job.run", capabilityPath: "job.run", startedAt: new Date() });
        context.createReceipt({ type: "job.run", capabilityPath: "job.run", startedAt: new Date() });
      }),
      receipts: true,
      receiptStore: innerStore
    });
    const outer = new Capsule({
      adapter: jobAdapter("outer", async (context) => {
        outerContext = context;
        await inner.job.run({ image: "x", idempotencyKey: "inner-key" });
      }),
      receipts: true,
      receiptStore: outerStore
    });
    await outer.job.run({ image: "x", idempotencyKey: "outer-key" });
    expect(outerStore.receipts.map((receipt) => [receipt.provider, receipt.metadata?.idempotencyKey])).toEqual([["outer", "outer-key"]]);
    expect(innerStore.receipts.map((receipt) => [receipt.provider, receipt.metadata?.idempotencyKey])).toEqual([["inner", "inner-key"]]);
  });

  test("many instances share the context without mixing their operations", async () => {
    const stores = Array.from({ length: 50 }, () => new MemoryReceiptStore());
    const capsules = stores.map(
      (store, index) =>
        new Capsule({
          adapter: jobAdapter(`p${index}`, async (context) => {
            await new Promise((resolve) => setImmediate(resolve));
            context.createReceipt({ type: "job.run", capabilityPath: "job.run", startedAt: new Date() });
          }),
          receipts: true,
          receiptStore: store
        })
    );
    await Promise.all(capsules.map((capsule, index) => capsule.job.run({ image: "x", idempotencyKey: `key-${index}` })));
    stores.forEach((store, index) => expect(store.receipts.map((receipt) => receipt.metadata?.idempotencyKey)).toEqual([`key-${index}`]));
  });
});
