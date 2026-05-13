# 0001: Use Plain Strict TypeScript For The V1 Core

## Status

Accepted.

## Context

Capsule needs to be easy for adapter authors, framework maintainers, and provider teams to inspect and implement. The core package defines public domain contracts, capability negotiation, policy evaluation, receipts, and adapter facades. It should be usable from CLIs, agent runtimes, CI systems, preview systems, and backend services without forcing a runtime framework.

Libraries such as Effect can provide structured errors, typed effects, dependency injection, retries, tracing, and resource safety. Those benefits are real, especially for larger orchestration systems. They also introduce a distinct programming model that every adapter author must understand before contributing.

## Decision

Capsule v1 uses plain strict TypeScript, ESM, small local helpers, Node standard library APIs where possible, and minimal dependencies.

Effect is not part of the public v1 core API.

## Consequences

What this gains:

- low contribution friction for adapter authors;
- fewer transitive dependencies in security-sensitive runtime code;
- easier inspection by provider teams that want to validate the adapter contract;
- simpler examples for users who only need `new Capsule({ adapter })`;
- freedom to run in many Node-based contexts without framework assumptions.

What this loses:

- no built-in typed effect system for retries, scopes, cancellation, or tracing;
- more responsibility on Capsule to keep error, timeout, and cleanup helpers disciplined;
- fewer high-level composition tools for preview orchestration;
- less compile-time modeling of complex provider workflows.

## Follow-Up

Capsule can still add optional integration packages later, such as `@capsule/effect`, if a real use case needs typed resources or workflow composition. That package should wrap the stable core contract instead of replacing it.

