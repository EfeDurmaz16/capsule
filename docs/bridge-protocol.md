# Fabric bridge protocol

Capsule can run as a provider worker for [Fabric](https://github.com/EfeDurmaz16/fabric), a durable job runner. Fabric spawns the worker as a local child process and sends it one governed provider action at a time over framed stdio. This page is a pointer. The specification lives in Fabric and is the single source of truth:

- Specification: Fabric `docs/bridge-protocol.md` (bridge protocol v1).
- Decision record: Fabric `docs/adr/0021-capsule-provider-bridge.md`, adopting drafts P09 (scoped provider identity and truthful outcomes) and P10 (Capsule worker protocol) as Proposed.

Status: proposed, 2026-10-27. No worker is implemented or released yet.

## What Capsule owns

| Concern                                                                                | Owner          |
| -------------------------------------------------------------------------------------- | -------------- |
| Job, task, attempt and operation identity, the operation journal, placement, fencing   | Fabric         |
| Provider mapping, provider calls and observations, receipts, Capsule policy evaluation | Capsule worker |

The worker keeps no durable job state. A worker restart is transport loss, never cancellation, and never a reason to retry an action.

## Rules that touch existing Capsule types

- The wire locator is Capsule's `ResourceLocator` in snake case: `provider`, `scope`, `kind`, `native_id`, optional `native_operation_id`. Every effect and result carries it.
- A terminal-only action that does not reach a terminal state within its deadline answers `pending` with the locator, last state, observation count and deadline, the shape of `PendingOperationError`. An action whose effect cannot be known answers `unknown` with the best known locator, the shape of `UnknownOutcomeError`.
- Refusals (`invalid`, `unsupported`, `denied`, `unavailable`) happen before any provider call and carry `effect: "none"`.
- Fresh per-operation approval is additive: it never overrides a policy deny, and a create grant never authorizes destroy.
- A present secrets block with omitted `allowed` denies all secrets; two allowlists merge by intersection.

## Fixtures

`protocol/bridge/v1` in this repository is a byte-identical copy of Fabric's `protocol/bridge/v1`: framed byte cases, message cases, scenarios for the deterministic fixture provider, and the v1 capability profiles for the fixture provider and local Docker. `scripts/bridge-fixtures.test.mjs` checks every file against `manifest.sha256` and pins the manifest's own sha256; Fabric pins the same digest. Do not edit these files here. Change them in Fabric first, then copy the directory and update the pin in both repositories in linked pull requests. Prettier ignores the directory so its bytes stay exact.
