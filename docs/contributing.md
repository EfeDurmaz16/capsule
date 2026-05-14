# Contributing

## Install

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Live Tests

Live provider tests must use `@capsule/test-utils` and remain skipped by default. The shared gate only enables live operations when `CAPSULE_LIVE_TESTS=1` is present and the provider-specific credential environment variables are set. Skip reasons should name the missing flag or credential variables so CI output explains why a live test did not run.

## Add An Adapter

Start with [Adding a provider adapter](adding-provider-adapter.md) and the [Adapter contract](adapter-contract.md).

1. Classify the provider service with `capsule classify provider <provider> <service>`.
2. Scaffold the package with `capsule adapter scaffold <provider> --domain <domain>` when the default package shape fits.
3. Export a factory that returns `CapsuleAdapter`.
4. Declare a complete capability map.
5. Implement only the domains the provider supports.
6. Use `native`, `emulated`, `unsupported`, and `experimental` honestly.
7. Add contract tests.
8. Add docs and examples.

Adapter PRs are expected to explain:

- which runtime domains are implemented;
- which capabilities are `native`, `emulated`, `experimental`, or `unsupported`;
- which policy controls are provider-native, delegated, best-effort, or not supported;
- how credentials are loaded without printing secret values;
- which live tests are gated by `CAPSULE_LIVE_TESTS=1`;
- which provider-specific fields are exposed through `raw` or typed options.

## Official Provider Adapters

Provider teams are welcome to propose official adapters. An official adapter should have a named maintainer, provider-reviewed capability map, public quickstart, contract tests, skipped-by-default live tests, and compatibility notes for provider API changes.

Official ownership does not mean Capsule hides provider differences. It means the provider helps keep support levels, docs, examples, and security caveats accurate.

## Propose A Primitive

Open an issue describing the domain, operations, provider examples, abstraction risks, policy concerns, receipt fields, and why existing domains are insufficient.

## Issue Taxonomy

Use labels to make the task graph inspectable:

| Label family | Meaning |
| --- | --- |
| `type:feature` | New capability, adapter behavior, CLI command, or package surface. |
| `type:test` | Contract, unit, live-gated, fixture, or regression coverage. |
| `type:docs` | README, docs, examples, ADRs, runbooks, or release notes. |
| `type:infra` | CI, release, package metadata, automation, scripts, or repo maintenance. |
| `type:security` | Policy enforcement, secrets handling, receipt integrity, auth, or provider credential risk. |
| `type:audit` | Gap analysis, readiness review, matrix verification, or compliance check. |
| `area:core` | `@capsule/core` contracts, facades, policy, receipts, errors, capabilities. |
| `area:adapter` | Provider adapter implementation or adapter-specific docs/tests. |
| `area:cli` | `@capsule/cli` command behavior and diagnostics. |
| `area:docs` | Public documentation and examples. |
| `area:oss` | Repository polish, comparison, contribution model, public GitHub surface. |
| `provider:*` | Provider-specific work such as `provider:docker`, `provider:vercel`, or `provider:neon`. |
| `release:v1` / `release:v2` | Release layer the issue is targeting. |
| `needs-verification` | Work is not done until verification evidence is posted. |
| `needs-design` | Contract or architecture shape is not ready for implementation. |
| `blocked` | External dependency or missing decision prevents progress. |
Task issues should include a source task ID when possible, success criteria, required verification, and explicit guardrails. Large features should be split by package or domain so each PR can stay reviewable and atomic.

## Good First Issues

Good first issues should produce real project value without requiring broad architecture changes:

- add contract tests for an existing mock adapter;
- improve provider matrix notes with a source link;
- add a focused example for one domain;
- improve policy notes for an adapter;
- document one provider-specific escape hatch;
- add a skipped-by-default live test fixture for one provider operation.

Avoid shallow issues such as typo-only churn, cosmetic badge changes without release value, or broad "research this provider" tickets without a concrete output.

## Ownership Model

Provider teams can own official adapters. Ownership means maintaining capability maps, docs, examples, tests, and compatibility notes when provider APIs change.
