# OSP Integration

OSP is the most natural adjacent integration for Capsule because the two systems own different parts of an agent/runtime workflow.

Capsule should not become a service registry or provisioning protocol. OSP should not become a runtime adapter SDK. The integration is useful precisely because those boundaries stay separate.

## Boundary

OSP owns service lifecycle:

- service intent;
- discovery;
- provisioning;
- binding;
- rotation;
- deprovisioning;
- approval-aware service acquisition;
- lifecycle state.

Capsule owns runtime action execution and evidence:

- sandbox, job, service, edge, database, machine, and preview domain APIs;
- capability negotiation;
- support levels;
- policy checks;
- logs and artifacts normalization;
- execution, deployment, resource, cleanup, and preview receipts;
- provider-specific escape hatches.

## Flow

```text
Agent / CI / Preview Controller
  -> OSP: resolve or provision service intents
  -> OSP: produce concrete provider/resource bindings
  -> Capsule: execute provider-domain actions
  -> Capsule: return receipts
  -> OSP: store binding, lifecycle state, deprovision plan, and receipt references
```

Example preview flow:

```text
Intent:
  preview database
  edge worker
  smoke check job

OSP:
  resolves database provider and branch policy
  resolves edge provider and route policy
  resolves job runtime

Capsule:
  database.branchCreate through Neon
  edge.deploy through Cloudflare or Vercel
  job.run through Docker, Fly, Cloud Run, Kubernetes, ECS, or another job adapter
  preview dry-run receipt or orchestration receipt

OSP:
  records service bindings
  tracks TTL/deprovisioning
  calls Capsule cleanup actions when lifecycle ends
```

## Shared Contract Shape

An OSP-to-Capsule handoff should be concrete and provider-aware:

```ts
interface OspCapsuleAction {
  domain: "database" | "edge" | "service" | "job" | "machine" | "sandbox";
  capabilityPath: string;
  provider: string;
  adapter: string;
  spec: Record<string, unknown>;
  policy?: Record<string, unknown>;
  bindingId?: string;
  lifecycleId?: string;
}
```

Capsule executes the action only if the adapter declares the requested capability at an acceptable support level. The returned receipt can be stored by OSP as lifecycle evidence.

## Why This Helps

Without OSP, a caller can use Capsule directly:

```text
create Neon branch
deploy Cloudflare Worker
run Docker smoke job
cleanup resources
```

With OSP, the caller can ask for a service intent first:

```text
give this pull request an isolated Postgres branch and edge preview
```

OSP decides or records what was provisioned. Capsule proves what runtime/provider actions were taken.

## What Not To Do

Do not make Capsule depend on OSP.

Do not put OSP lifecycle state into `@capsule/core`.

Do not make OSP claim Capsule adapter support. Capability support remains an adapter declaration.

Do not treat OSP provisioning success as runtime execution evidence. Capsule receipts remain the evidence for provider actions Capsule performed.

Do not flatten provider differences. If OSP resolves a Cloudflare Worker, Capsule should still execute an `edge.*` operation with Cloudflare-specific route/version/binding caveats.

## Future Package Shape

A future optional package could be:

```text
@capsule/osp
```

Possible responsibilities:

- convert OSP service bindings into Capsule specs;
- attach OSP lifecycle IDs to receipt metadata;
- validate Capsule capability requirements before OSP provisions a service;
- produce cleanup plans from OSP lifecycle state;
- store Capsule receipt IDs back into OSP evidence records.

This package should stay optional. Capsule remains useful without OSP, and OSP remains useful without Capsule.
