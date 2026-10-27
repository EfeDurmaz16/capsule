// Audit regressions for the M1 campaign (Lambda). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. The client is an injected fake.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { lambda } from "./index.js";

describe("M1 audit regressions: lambda", () => {
  it.fails("AWS-03: job.run rejects the DryRun invocation type before any provider request", async () => {
    let sends = 0;
    const capsule = new Capsule({
      adapter: lambda({
        functionName: "audit",
        invocationType: "DryRun",
        client: {
          send: async () => {
            sends += 1;
            return { StatusCode: 204 };
          }
        } as never
      }),
      receipts: true
    });
    const outcome = await capsule.job.run({ image: "intent-only" }).then(
      () => "resolved",
      () => "rejected"
    );
    expect(outcome).toBe("rejected");
    expect(sends).toBe(0);
  });
});
