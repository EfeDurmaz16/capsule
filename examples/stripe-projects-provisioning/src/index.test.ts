import { describe, expect, it } from "vitest";
import { createProvisioningCapsule, deriveApprovalGrant, provisionProject, run, type ProvisionOutcome, type StripePaymentIntent } from "./index.js";

const paid: StripePaymentIntent = { id: "pi_paid", status: "succeeded", amountUsd: 20, projectSlug: "acme-staging", customer: "cus_acme" };
const unpaid: StripePaymentIntent = { id: "pi_unpaid", status: "requires_payment_method", amountUsd: 20, projectSlug: "acme-staging", customer: "cus_acme" };

describe("stripe projects provisioning", () => {
  it("only approves a confirmed payment intent", () => {
    expect(deriveApprovalGrant(paid).approved).toBe(true);
    expect(deriveApprovalGrant(unpaid).approved).toBe(false);
    expect(deriveApprovalGrant(paid).capabilities).toEqual(["service.deploy"]);
  });

  it("denies provisioning for an unpaid intent without creating a resource", async () => {
    const capsule = createProvisioningCapsule();
    const ledger = new Map<string, ProvisionOutcome>();
    const outcome = await provisionProject(capsule, ledger, unpaid);
    expect(outcome.decision).toBe("denied");
    expect(outcome.serviceId).toBeUndefined();
    expect(ledger.size).toBe(0);
  });

  it("provisions once for a paid intent and reuses it on retry", async () => {
    const capsule = createProvisioningCapsule();
    const ledger = new Map<string, ProvisionOutcome>();
    const first = await provisionProject(capsule, ledger, paid);
    const second = await provisionProject(capsule, ledger, paid);
    expect(first.decision).toBe("provisioned");
    expect(first.serviceId).toBeDefined();
    expect(second.decision).toBe("reused");
    expect(second.serviceId).toBe(first.serviceId);
    expect(ledger.size).toBe(1);
  });

  it("runs the full deny, provision, retry sequence", async () => {
    const [denied, provisioned, retried] = await run();
    expect(denied.decision).toBe("denied");
    expect(provisioned.decision).toBe("provisioned");
    expect(retried.decision).toBe("reused");
    expect(retried.serviceId).toBe(provisioned.serviceId);
  });
});
