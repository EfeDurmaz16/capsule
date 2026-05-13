# 0003: Prefer Adapter-First Provider Boundaries

## Status

Accepted.

## Context

Capsule spans sandboxes, jobs, services, edge runtimes, database resources, previews, and machines. Providers overlap, but they do not expose the same control surfaces. For example, Docker can run sandboxes and jobs, Neon owns database branches, Vercel and Cloudflare expose edge-specific deployment primitives, and EC2 exposes low-level machines.

A fake universal API would hide important provider differences and create unsafe assumptions.

## Decision

Capsule is adapter-first and domain-aware.

Each adapter declares a capability map with explicit support levels: `native`, `emulated`, `experimental`, or `unsupported`. The core never guesses support and never silently emulates provider behavior without marking the support level.

Provider-specific `raw` escape hatches are allowed when they are explicit.

## Consequences

What this gains:

- honest provider modeling;
- safer unsupported-capability behavior;
- clearer adapter contract tests;
- room for provider-specific features without distorting the common domain model;
- easier critique from provider teams because claims are explicit.

What this loses:

- users must handle provider differences instead of assuming perfect portability;
- examples and docs need to explain support levels carefully;
- some workflows require provider-specific configuration;
- the SDK cannot promise one deployment spec maps cleanly to every platform.

## Follow-Up

Adapter contract tests should verify both behavior and declared support levels. Provider-maintained adapters should be able to extend the public capability map without weakening the shared contract.

