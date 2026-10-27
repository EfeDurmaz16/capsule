// Audit regressions for the M1 campaign (ECS). Each test asserts the INTENDED behavior from the M1
// manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner who
// fixes an ID flips its it.fails to it in the same commit. The client is an injected fake.
import { describe, expect, it } from "vitest";
import { Capsule, PendingOperationError } from "@capsule-sdk/core";
import { ecs } from "./index.js";

describe("M1 audit regressions: ecs", () => {
  it("AWS-04: a DRAINING service with running tasks is never reported deleted", async () => {
    let rejection: unknown;
    const capsule = new Capsule({
      adapter: ecs({
        cluster: "audit",
        taskDefinition: "audit:1",
        containerName: "main",
        deleteObservation: { deadlineMs: 50, intervalMs: 5 },
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
        (error: unknown) => {
          rejection = error;
          return { state: "rejected" as const, status: undefined, receiptStatus: undefined };
        }
      ),
      new Promise<{ state: "pending"; status: undefined; receiptStatus: undefined }>((resolve) =>
        setTimeout(() => resolve({ state: "pending", status: undefined, receiptStatus: undefined }), 1000)
      )
    ]);
    expect(outcome.status).not.toBe("deleted");
    expect(outcome.receiptStatus).not.toBe("deleted");
    expect(outcome.state).toBe("rejected");
    expect(rejection).toBeInstanceOf(PendingOperationError);
    expect(rejection).toMatchObject({ operation: "service.delete", state: "DRAINING", resource: { provider: "ecs", kind: "service", nativeId: "arn:audit" } });
  });
});
