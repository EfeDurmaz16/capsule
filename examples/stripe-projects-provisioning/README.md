# Capsule + Stripe Projects provisioning

A credential-free example where a Stripe-style payment intent gates an infrastructure provisioning flow. It uses `@capsule-sdk/mock`, so it calls no real provider and no real Stripe API.

## The idea

A confirmed payment should be the thing that authorizes provisioning, and it should authorize it exactly once. This example models that with two Capsule primitives:

- **Spend-approval policy**: the Capsule is configured with `approvals: { required: true }`. Provisioning is denied by default. A payment intent turns into a capability- and resource-scoped approval grant only when its status is `succeeded`. An unpaid intent produces an unapproved grant, and the policy denies the deploy before any provider call.
- **Idempotency key**: the payment intent id is the idempotency key. Within one process, a retry or a concurrent duplicate with the same intent converges to one provisioning: completed results are cached in a small in-memory ledger keyed by intent id, and an attempt that is still running is shared by concurrent callers. A failed attempt is not cached, so a later retry can provision.

## Run it

```bash
pnpm --filter @capsule-sdk/example-stripe-projects-provisioning start
```

Expected output (ids are illustrative):

```
Example mode: mock Cloud Run spend-approval provisioning. No real provider APIs or Stripe calls are made.
unpaid intent pi_3Unpaid000000000000: denied (Approval required by policy: provisioning requires a confirmed Stripe payment)
paid intent pi_3Paid00000000000000: provisioned -> https://acme-staging.cloud-run.mock.capsule.dev
retry intent pi_3Paid00000000000000: reused (same service true)
```

## What to take from it

- The payment is the grant. Capsule never provisions on an unconfirmed intent.
- The grant is scoped: it authorizes `service.deploy` for that project's service resource only.
- Retries and concurrent duplicates in one process are coalesced. The same payment intent id gates a single provision for as long as the process and its ledger live.

## Limits

The ledger and the in-flight map are process memory. They do not survive a restart and do not coordinate several processes or servers, so this example is not exactly-once payment fulfillment. A restart between the deploy and the ledger write, or two workers handling the same webhook, can still provision twice. Passing `idempotencyKey` to the adapter does not guarantee provider-side deduplication; each provider decides what it does with it. Production fulfillment needs a durable ledger keyed by intent id and reconciliation against the provider.

Swapping `mockCloudRun()` for a real adapter keeps the policy gate. It does not add the durability above.
