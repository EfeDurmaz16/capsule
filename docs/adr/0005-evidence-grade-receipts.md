# 0005: Make Evidence-Grade Receipts An Explicit Profile

## Status

Accepted.

## Context

Capsule receipts are currently observational records. They are useful for debugging, audit trails, preview cleanup, and agent execution traces, but they are not enough for high-assurance evidence by default.

Security-sensitive users need to know whether a receipt was sanitized, operation-scoped, signed, durably stored, and correlated with provider evidence. They also need to know when a provider action may have happened even though receipt persistence failed.

## Decision

Evidence-grade receipts will be an explicit profile above normal receipt capture. The profile must require:

- operation-scoped receipt creation;
- provider and adapter stamping by Capsule, not adapters;
- metadata and provider option redaction before signing or storage;
- a configured receipt signer;
- a configured durable receipt store;
- preflight store health checks before destructive or billable provider calls;
- failure reporting that distinguishes provider failure, cleanup failure, and evidence persistence failure.

Best-effort receipts remain the default for developer ergonomics and local examples. `receiptPersistence: "required"` remains a detection mechanism until a pre-execution evidence profile is implemented; it should not be described as proof that no side effect occurred.

## Consequences

What this gains:

- honest language for security-sensitive users;
- a clear upgrade path from normal OSS receipts to FIDES-style evidence;
- room to support append-only stores, signed bundles, provider audit log correlation, and attestations without bloating the core SDK;
- release discipline around receipt guarantees.

What this loses:

- evidence-grade mode will require more configuration than `receipts: true`;
- some provider actions may need preflight checks or two-phase workflows;
- adapters must report cleanup and persistence failures precisely instead of collapsing them into generic errors.

## Follow-Up

Add the evidence profile after the receipt store durability contract is tightened. The first implementation should avoid new heavy dependencies and should prove no destructive provider call starts when the required store or signer is missing.
