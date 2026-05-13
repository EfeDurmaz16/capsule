# 0004: Treat Receipts As Observational Evidence

## Status

Accepted.

## Context

Capsule produces receipts for executions, deployments, resources, previews, and machine operations. These receipts include provider, adapter, capability path, support level, timing, policy decision, output hashes, and resource metadata.

Receipts are useful for agent safety, CI traceability, preview cleanup, audit trails, and future attestations. They are not equivalent to complete provider truth or OS-level enforcement proof.

## Decision

Capsule receipts describe what Capsule requested, observed, and normalized. They do not claim absolute truth about the provider, host kernel, network boundary, billing system, or external side effects.

Receipt signing is represented in the type model but remains optional until a clean signing and key-management story is available.

## Consequences

What this gains:

- useful evidence without overclaiming security;
- stable schema for logs, artifacts, policy decisions, and resource IDs;
- compatibility with future FIDES-style attestations;
- safe language for local Docker and best-effort policy enforcement.

What this loses:

- receipts are not a substitute for provider audit logs;
- unsigned receipts can be altered by the caller;
- external side effects may exist outside what Capsule observed;
- security-sensitive users still need provider-native logs, IAM controls, and runtime isolation guarantees.

## Follow-Up

Signed receipts, append-only storage, and provider-native audit log correlation should be built as optional layers on top of the receipt schema.

