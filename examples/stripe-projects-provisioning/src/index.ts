import { pathToFileURL } from "node:url";
import { Capsule, PolicyViolationError, type CapsuleApprovalGrant, type CapsuleReceipt } from "@capsule/core";
import { mockCloudRun } from "@capsule/adapter-mock";

// A Stripe-style payment intent. In a real integration this is fetched from Stripe by id and
// trusted only after its status is confirmed server-side. Here it is a plain object so the
// example runs credential-free with a mock provider.
export type PaymentIntentStatus = "requires_payment_method" | "succeeded";

export interface StripePaymentIntent {
  id: string;
  status: PaymentIntentStatus;
  amountUsd: number;
  projectSlug: string;
  customer: string;
}

export type ProvisionDecision = "provisioned" | "reused" | "denied";

export interface ProvisionOutcome {
  intentId: string;
  projectSlug: string;
  decision: ProvisionDecision;
  serviceId?: string;
  url?: string;
  reason?: string;
  receipt?: CapsuleReceipt;
}

// The capability the payment gates. The approval grant is scoped to exactly this path and the
// project's service resource, so a paid intent for project A cannot approve provisioning B.
const provisioningCapability = "service.deploy";
const provisioningImage = "us-docker.pkg.dev/cloudrun/container/hello";

// The paid payment intent is the approval grant. A confirmed intent turns into an approved,
// capability- and resource-scoped grant; an unconfirmed one stays unapproved and the policy
// denies provisioning before any provider call.
export function deriveApprovalGrant(intent: StripePaymentIntent): CapsuleApprovalGrant {
  return {
    approved: intent.status === "succeeded",
    id: intent.id,
    approver: intent.customer,
    reason: `Stripe payment intent ${intent.id} for project ${intent.projectSlug}`,
    capabilities: [provisioningCapability],
    resources: [{ type: "service", name: intent.projectSlug }],
    metadata: { paymentIntent: intent.id, amountUsd: intent.amountUsd.toFixed(2) }
  };
}

export function createProvisioningCapsule(): Capsule {
  return new Capsule({
    adapter: mockCloudRun(),
    receipts: true,
    // Deny by default: no provisioning without an approval grant. cost.maxUsd is a control-plane
    // ceiling recorded on the receipt, not a billing guarantee.
    policy: { approvals: { required: true, reason: "provisioning requires a confirmed Stripe payment" }, cost: { maxUsd: 100 } }
  });
}

// The payment intent id is also the idempotency key. A retry with the same intent must converge to
// the same result and must not provision twice, so results are cached by intent id. After an
// irreversible external action, swallow-and-alert rather than re-raising a double-provision.
export async function provisionProject(capsule: Capsule, ledger: Map<string, ProvisionOutcome>, intent: StripePaymentIntent): Promise<ProvisionOutcome> {
  const existing = ledger.get(intent.id);
  if (existing) {
    return { ...existing, decision: "reused" };
  }

  try {
    const deployment = await capsule.service.deploy({
      name: intent.projectSlug,
      image: provisioningImage,
      approval: deriveApprovalGrant(intent),
      idempotencyKey: intent.id,
      labels: { "capsule-example": "stripe-projects-provisioning", "stripe-payment-intent": intent.id }
    });
    const outcome: ProvisionOutcome = {
      intentId: intent.id,
      projectSlug: intent.projectSlug,
      decision: "provisioned",
      serviceId: deployment.id,
      url: deployment.url,
      receipt: deployment.receipt
    };
    ledger.set(intent.id, outcome);
    return outcome;
  } catch (error) {
    if (error instanceof PolicyViolationError) {
      return { intentId: intent.id, projectSlug: intent.projectSlug, decision: "denied", reason: error.message };
    }
    throw error;
  }
}

const scenarios: StripePaymentIntent[] = [
  { id: "pi_3Unpaid000000000000", status: "requires_payment_method", amountUsd: 20, projectSlug: "acme-staging", customer: "cus_acme" },
  { id: "pi_3Paid00000000000000", status: "succeeded", amountUsd: 20, projectSlug: "acme-staging", customer: "cus_acme" }
];

export async function run(): Promise<ProvisionOutcome[]> {
  console.log("Example mode: mock Cloud Run spend-approval provisioning. No real provider APIs or Stripe calls are made.");
  const capsule = createProvisioningCapsule();
  const ledger = new Map<string, ProvisionOutcome>();
  const outcomes: ProvisionOutcome[] = [];

  // 1. Unpaid intent: policy denies provisioning, nothing is created.
  const denied = await provisionProject(capsule, ledger, scenarios[0]);
  outcomes.push(denied);
  console.log(`unpaid intent ${denied.intentId}: ${denied.decision} (${denied.reason ?? "no reason"})`);

  // 2. Paid intent: the payment approves provisioning.
  const provisioned = await provisionProject(capsule, ledger, scenarios[1]);
  outcomes.push(provisioned);
  console.log(`paid intent ${provisioned.intentId}: ${provisioned.decision} -> ${provisioned.url ?? "no url"}`);

  // 3. Retry the paid intent: the idempotency key converges to the same result, no second provision.
  const retried = await provisionProject(capsule, ledger, scenarios[1]);
  outcomes.push(retried);
  console.log(`retry intent ${retried.intentId}: ${retried.decision} (same service ${retried.serviceId === provisioned.serviceId})`);

  return outcomes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
