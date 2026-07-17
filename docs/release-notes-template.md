# Release Notes Template

Use this template when preparing a Capsule release PR, GitHub release, or npm publish summary. Keep the note concrete: name the package, changed capability path, adapter, or command, and include the verification evidence that protects users from install, policy, receipt, or provider-lifecycle regressions.

## Summary

One or two sentences describing the release outcome and who should care.

## Core

- `@capsule-sdk/core`: Describe policy, receipt, capability, error, telemetry, store contract, or public type changes.

## Adapters

- `@capsule-sdk/<provider>`: Describe provider behavior, lifecycle cleanup, idempotency, receipt metadata, policy support, or live-test coverage changes.

## CLI, Presets, Preview, And AI

- `@capsule-sdk/cli`: Describe command, JSON output, diagnostics, doctor, capability, or verification changes.
- `@capsule-sdk/presets`: Describe preset behavior, validation, or policy compatibility changes.
- `@capsule-sdk/preview`: Describe orchestration, cleanup plan, resource graph, or receipt changes.
- `@capsule-sdk/ai`: Describe wrapper, framework descriptor, or governed action example changes.

## Docs And Examples

- Docs: Describe changed public docs, ADRs, runbooks, quickstarts, matrices, or comparison pages.
- Examples: Describe runnable examples and any provider credentials or cost-risk notes they require.

## Security, Policy, And Evidence

- Policy: Describe fail-closed behavior, approvals, TTLs, idempotency, or raw-provider guardrails.
- Evidence: Describe receipt durability, signing, redaction, provenance, or audit bundle changes.
- Secrets: State whether secret handling, logging, or credential requirements changed.

## Breaking Changes

- Package or command:
  - What changed:
  - Who is affected:
  - Migration path:

Write `None` only when the release has no breaking behavior or API changes.

## Verification

Paste the exact commands run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm release:audit
pnpm docs:api
git diff --exit-code docs/api-reference.md
```

Add any focused checks, live-test dry runs, provider cleanup commands, or provenance checks that are relevant to the release.

## Known Risks

- State unresolved provider limitations, skipped live tests, unsupported partial semantics, flaky tests, or docs gaps.
- State whether the risk affects install, runtime execution, policy enforcement, receipts, cleanup, or only documentation.
