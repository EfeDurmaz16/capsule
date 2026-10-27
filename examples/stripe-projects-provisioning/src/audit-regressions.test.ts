// Audit regression for the M1 campaign (COMP-04). Asserts the INTENDED behavior and is marked it.fails
// while the defect is present on the baseline (7d3a28a); the owner flips it to it when fixed. The Capsule
// adapter is an in-memory fake; no payment provider or deployment target is contacted.
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { provisionProject, type ProvisionOutcome, type StripePaymentIntent } from "./index.js";

describe("M1 audit regressions: stripe projects provisioning", () => {
  it.fails("COMP-04: concurrent duplicate paid intents coalesce into one process-local provisioning", async () => {
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
    await Promise.all([provisionProject(capsule, ledger, intent), provisionProject(capsule, ledger, intent)]);
    expect(deployments).toBe(1);
  });
});
