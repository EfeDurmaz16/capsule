// Audit regressions for the M1 campaign (ECS). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. The client is an injected fake.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { ecs } from "./index.js";

describe("M1 audit regressions: ecs", () => {
  it.fails("AWS-04: a DRAINING service with running tasks is never reported deleted", async () => {
    const capsule = new Capsule({
      adapter: ecs({
        cluster: "audit",
        taskDefinition: "audit:1",
        containerName: "main",
        client: {
          send: async () => ({
            service: { serviceArn: "arn:audit", status: "DRAINING", runningCount: 1 },
            services: [{ serviceArn: "arn:audit", status: "DRAINING", runningCount: 1 }]
          })
        } as never
      }),
      receipts: true
    });
    const outcome = await Promise.race([
      capsule.service.delete({ id: "arn:audit", force: true }).then(
        (value) => ({ state: "resolved" as const, status: value.status as string, receiptStatus: value.receipt?.resource?.status }),
        () => ({ state: "rejected" as const, status: undefined, receiptStatus: undefined })
      ),
      new Promise<{ state: "pending"; status: undefined; receiptStatus: undefined }>((resolve) =>
        setTimeout(() => resolve({ state: "pending", status: undefined, receiptStatus: undefined }), 1000)
      )
    ]);
    expect(outcome.status).not.toBe("deleted");
    expect(outcome.receiptStatus).not.toBe("deleted");
  });
});
