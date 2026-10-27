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

describe("deferred M1 items (visible skips with reason and dependency)", () => {
  // GAP-14 deferred: a circuit-breaker rollback and a user's superseding redeploy both appear as a PRIMARY
  // IN_PROGRESS deployment next to an ACTIVE FAILED one, and the documented DescribeServices fields do not
  // tell them apart. Dependency: recorded DescribeServices responses from a real circuit-breaker rollback and
  // from a superseding deploy after a FAILED rollout (an opt-in live ECS run, outside M1). Until then the
  // current rule (any FAILED deployment reports failed) stays.
  it.skip("GAP-14 (deferred): a superseding PRIMARY deployment is not reported failed because of an older FAILED deployment", () => {
    // Intended assertion once provider-recorded fixtures exist: service.status reports the PRIMARY rollout's
    // state when a newer deploy superseded a FAILED one, and failed for a circuit-breaker rollback.
  });
});
