# Capsule V1 Readiness Audit

Date: 2026-05-13

This audit records the current repository state after the v1 issue run. It is intentionally evidence-oriented: shipped means visible in this checkout and verified by commands, not merely planned.

## Result

Capsule is ready as a pre-1.0 OSS SDK/control-plane foundation.

The repository now contains the TypeScript pnpm monorepo, core domain contracts, real provider adapters for the original provider families, mock adapters for examples/tests, CLI, AI helper, preview orchestration package, receipt store, docs, examples, contract tests, release hardening, GitHub issue workflow, Linear mirroring, and Symphony-compatible runbook.

This is not a hosted product. It has no bundled server, dashboard, auth layer, billing, or database. That remains an explicit architecture decision for the SDK core.

## Original Requirement Map

| Requirement area | Status | Evidence |
| --- | --- | --- |
| TypeScript, ESM, strict mode, pnpm workspace | Shipped | Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, package `type: module`, `tsc -b` verification. |
| Core package with domain types, Capsule facade, capabilities, errors, policy, receipts, logs, artifacts, adapters, contracts | Shipped | `packages/core`; API reference generated in `docs/api-reference.md`. |
| Sandbox, job, service, edge, database, preview, machine domain APIs | Shipped as SDK contracts and facades | `@capsule/core` and package API docs. |
| Capability negotiation and support levels | Shipped | `supports`, `supportLevel`, capability maps, contract tests, provider matrix. |
| Policy model, secret denial, timeout merging, redaction, receipt policy decisions | Shipped | Core policy implementation, tests, docs. |
| Receipt model with SHA-256 hashes and future signing shape | Shipped | Core receipts, JSON schema export, optional signing interface. |
| Docker adapter using Docker CLI | Shipped | `@capsule/adapter-docker`, Docker live tests skipped when Docker is unavailable. |
| Mock adapters | Shipped for tests/examples only | `@capsule/adapter-mock`, README and provider matrix clearly mark mock scope. |
| Real provider adapters beyond Docker | Shipped for original provider families | E2B, Daytona, Modal, Cloud Run, Cloudflare, Vercel, Neon, Kubernetes, Lambda, ECS, EC2, Fly, Azure Container Apps packages exist and are verified by build/tests. |
| AI package | Shipped | `@capsule/ai` with framework-agnostic code execution helper. |
| CLI package | Shipped | `@capsule/cli` with doctor, capabilities, Docker run/sandbox, provider diagnostics, lifecycle commands. |
| Examples | Shipped | Ten examples under `examples/`, with mock defaults and env-gated real adapters where applicable. |
| Serious docs | Shipped | README plus architecture, taxonomy, domain, security, comparison, provider, roadmap, contributing, ADR, runbook docs. |
| Tests | Shipped | 24 test files: 21 passed, 3 skipped; 131 tests total, 123 passed and 8 skipped locally. |
| Release workflow | Shipped | Changesets, npm provenance workflow, package publish audit, export-map audit. |
| Symphony/autopilot workflow | Shipped | `WORKFLOW.md`, `.capsule/tasks.json`, GitHub issue creation, Linear mirror, local autopilot runner, stale lock recovery, PR reconciliation. |

## What Is Real

- Core SDK contracts and `Capsule` facade.
- Capability lookup and unsupported capability errors.
- Policy evaluation, timeout merging, secret allowlist denial, redaction, and enforcement notes.
- Receipts with hashes, policy decision, resource metadata, JSON schema, and optional signing interface.
- Docker CLI sandbox and job execution.
- Real adapter packages for E2B, Daytona, Modal, Cloud Run, Cloudflare Workers, Vercel, Neon, Kubernetes, Lambda, ECS/Fargate, EC2, Fly Machines, and Azure Container Apps.
- Preview orchestration helper package.
- Local JSONL receipt store.
- CLI commands and provider credential diagnostics.
- Contract tests and live-test gates.
- GitHub/Linear/Symphony automation scaffolding.

## What Remains Mocked

`@capsule/adapter-mock` remains intentionally mocked for tests, examples, docs, and provider capability modeling. It is not used to claim real provider support.

No original provider family from the prompt is represented only by mocks. Remaining gaps are per-capability lifecycle depth, provider-specific advanced features, live smoke coverage, and optional future provider families.

## Known Limitations

- Capsule is not a sandbox by itself; isolation depends on Docker/provider configuration.
- Live provider tests are skipped unless `CAPSULE_LIVE_TESTS=1` and provider credentials are present.
- Some real adapters intentionally expose a narrow native slice and mark logs, rollback, route management, source deploy, artifact collection, or lifecycle depth as unsupported/experimental.
- Receipts are observational records, not absolute proof of host/provider truth.
- Packages are not published to npm yet; README install commands describe intended package names after publication.
- Hosted persistence, auth, dashboard, billing, queues, and server APIs are intentionally outside the SDK core.

## Technical Debt Check

Search terms checked: `TODO`, `FIXME`, `stub`, `mock level`, `technical debt`, `not implemented`, and raw `throw new Error`.

Findings:

- No `TODO`, `FIXME`, `stub`, `mock level`, or `technical debt` markers were found in shipped source.
- `not implemented` appears only where a provider capability is explicitly unsupported or intentionally narrowed, such as source deploy/log collection caveats and provider matrix notes.
- `throw new Error` appears in scripts, tests, CLI argument validation, contract assertions, and an adapter contract documentation snippet; these are not unfinished stubs.

## Verification

Commands run locally on 2026-05-13:

```bash
pnpm capsule:gap
pnpm docs:api
git diff --exit-code docs/api-reference.md
pnpm release:audit
pnpm typecheck
pnpm test
pnpm build
```

Results:

- `pnpm capsule:gap`: passed and produced adapter capability counts.
- `pnpm docs:api`: passed.
- `git diff --exit-code docs/api-reference.md`: passed; generated API reference is current.
- `pnpm release:audit`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed with 21 test files passed and 3 skipped; 123 tests passed and 8 skipped.
- `pnpm build`: passed across 31 workspace projects.

GitHub state before this audit PR:

- Open capsule issues: only #56.
- Open pull requests: none.

## Suggested Next PRs

These should be v2 issues rather than hidden debt:

1. Add provider log/status/read APIs consistently across real adapters where provider APIs support them.
2. Add live smoke tests for Cloud Run, Neon, Cloudflare, Vercel, Kubernetes, AWS, Fly, and Azure behind strict credential gates.
3. Add stronger receipt persistence options beyond JSONL only if a real downstream user needs them.
4. Add typed provider-specific option bags for advanced deploy routes, aliases, bindings, revisions, and rollbacks.
5. Publish packages through the Changesets release workflow after final npm ownership/token checks.
6. Add compatibility badges and npm version badges only after packages are actually published.

