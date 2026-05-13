# 0002: Keep The SDK Core Serverless And Database-Free

## Status

Accepted.

## Context

Capsule records where actions ran, what capability was used, what policy was applied, and what outputs were observed. That can sound like it requires an HTTP server, database, dashboard, auth system, or durable event store.

Those are useful product surfaces for a hosted control plane, but they are not required for an OSS SDK/spec layer. Requiring them in the core would make Capsule harder to embed in agents, CLIs, CI jobs, local developer tools, and provider SDK tests.

## Decision

The v1 core has no database dependency, backend framework, auth system, dashboard, or web app.

Capsule returns receipts to the caller. The caller decides where to persist them: a local file, CI artifact, object store, database, audit ledger, FIDES evidence layer, deployment platform, or hosted Capsule service if one exists later.

## Consequences

What this gains:

- small install surface and fewer operational assumptions;
- no forced persistence model for users with existing audit or deployment systems;
- easier use inside local tools, tests, and agents;
- clearer separation between SDK contract and future hosted product;
- lower security risk from bundled auth/session/database code.

What this loses:

- no built-in historical query layer for deployments or executions;
- no first-party dashboard in v1;
- no default multi-user authorization model;
- no automatic durable receipt storage;
- integrations must persist receipts explicitly if they need audit history.

## Follow-Up

Future packages may add optional persistence adapters or a hosted control-plane service. Those should consume `CapsuleReceipt` and adapter events from the SDK rather than forcing the SDK to depend on a database.

