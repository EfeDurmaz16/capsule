// Audit regression for the M1 campaign (COMP-04). Asserts the INTENDED behavior and is marked it.fails
// while the defect is present on the baseline (7d3a28a); the owner flips it to it when fixed. The Capsule
// adapter is an in-memory fake; no payment provider or deployment target is contacted.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { provisionProject, type ProvisionOutcome, type StripePaymentIntent } from "./index.js";

describe("M1 audit regressions: stripe projects provisioning", () => {
  it("COMP-04: concurrent duplicate paid intents coalesce into one process-local provisioning", async () => {
    let deployments = 0;
    const capsule = new Capsule({
      adapter: {
        name: "fake",
        provider: "fake",
        capabilities: { service: { deploy: "native" } } as never,
        service: {
          deploy: async (spec) => {
            deployments += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { id: `service-${deployments}`, provider: "fake", name: spec.name, status: "ready" };
          }
        }
      }
    });
    const ledger = new Map<string, ProvisionOutcome>();
    const intent: StripePaymentIntent = { id: "pi_same", status: "succeeded", amountUsd: 20, projectSlug: "acme", customer: "cus_acme" };
    const outcomes = await Promise.all([provisionProject(capsule, ledger, intent), provisionProject(capsule, ledger, intent)]);
    expect(deployments).toBe(1);
    expect(outcomes.map((outcome) => outcome.decision).sort()).toEqual(["provisioned", "reused"]);
    expect(new Set(outcomes.map((outcome) => outcome.serviceId)).size).toBe(1);
  });

  it("COMP-04: a failed provisioning does not poison later retries of the same intent", async () => {
    let attempts = 0;
    const capsule = new Capsule({
      adapter: {
        name: "fake",
        provider: "fake",
        capabilities: { service: { deploy: "native" } } as never,
        service: {
          deploy: async (spec) => {
            attempts += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (attempts === 1) throw new Error("transient provider failure");
            return { id: `service-${attempts}`, provider: "fake", name: spec.name, status: "ready" };
          }
        }
      }
    });
    const ledger = new Map<string, ProvisionOutcome>();
    const intent: StripePaymentIntent = { id: "pi_retry", status: "succeeded", amountUsd: 20, projectSlug: "acme", customer: "cus_acme" };
    const first = await Promise.allSettled([provisionProject(capsule, ledger, intent), provisionProject(capsule, ledger, intent)]);
    expect(first.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
    expect(attempts).toBe(1);
    await expect(provisionProject(capsule, ledger, intent)).resolves.toMatchObject({ decision: "provisioned", serviceId: "service-2" });
    expect(attempts).toBe(2);
  });
});
