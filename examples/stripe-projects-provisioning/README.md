# Capsule + Stripe Projects provisioning

A credential-free example where a Stripe-style payment intent gates an infrastructure provisioning flow. It uses `@capsule-sdk/adapter-mock`, so it calls no real provider and no real Stripe API.

## The idea

A confirmed payment should be the thing that authorizes provisioning, and it should authorize it exactly once. This example models that with two Capsule primitives:

- **Spend-approval policy**: the Capsule is configured with `approvals: { required: true }`. Provisioning is denied by default. A payment intent turns into a capability- and resource-scoped approval grant only when its status is `succeeded`. An unpaid intent produces an unapproved grant, and the policy denies the deploy before any provider call.
- **Idempotency key**: the payment intent id is the idempotency key. A retry with the same intent converges to the same result and never provisions twice. The example keeps a small in-memory ledger keyed by intent id to make that convergence explicit.

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
- Retries are safe. The same payment intent id gates a single provision.

Swap `mockCloudRun()` for a real adapter and add credentials to provision against a live provider. The policy and idempotency logic do not change.
