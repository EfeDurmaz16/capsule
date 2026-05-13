# Capsule V2 Readiness Audit

Date: 2026-05-13

This audit records the repository state after the v2 issue run. It is evidence-oriented: ready means the code, docs, release checks, GitHub issue state, and local verification commands agree in this checkout.

## Result

Capsule v2 is ready as an OSS TypeScript SDK/control-plane foundation for domain-aware execution and deployment adapters.

The v2 run closed the remaining release hardening and provider coverage work:

- preview cleanup now produces explicit evidence receipts and per-resource cleanup dispositions;
- production preview plans can require real providers and reject mock providers unless explicitly allowed;
- all public packages have publish metadata and pack/install/bin smoke coverage;
- live provider tests are centralized behind `CAPSULE_LIVE_TESTS=1` and provider credential gates;
- release audit now includes metadata, unfinished marker, and package pack smoke gates;
- the final open v2 issue set is reduced to this audit issue.

## GitHub State

Checked on 2026-05-13 before opening this audit PR:

- Open pull requests: none.
- Open `release:v2` issues: only `#131 [CAP-077] Run final v2 readiness audit`.

When the audit PR for this file is merged, the v2 issue set is closed by merged PRs.

## Release Gates

`pnpm release:audit` now runs:

1. package metadata audit for every public package;
2. unfinished marker gate over shipped source;
3. package pack smoke for every public package;
4. temporary install fixture using packed tarballs;
5. import smoke for all packed packages;
6. `@capsule/cli` bin smoke through `pnpm exec capsule capabilities`.

The pack smoke covered 20 public packages:

- `@capsule/core`
- `@capsule/adapter-docker`
- `@capsule/adapter-mock`
- `@capsule/adapter-e2b`
- `@capsule/adapter-daytona`
- `@capsule/adapter-modal`
- `@capsule/adapter-cloud-run`
- `@capsule/adapter-cloudflare`
- `@capsule/adapter-vercel`
- `@capsule/adapter-neon`
- `@capsule/adapter-kubernetes`
- `@capsule/adapter-lambda`
- `@capsule/adapter-ecs`
- `@capsule/adapter-ec2`
- `@capsule/adapter-fly`
- `@capsule/adapter-azure-container-apps`
- `@capsule/ai`
- `@capsule/cli`
- `@capsule/preview`
- `@capsule/store-jsonl`

## Marker Audit

`pnpm release:markers` passed.

Additional raw source search passed with no matches:

```bash
rg -n "TODO|FIXME|stub|mock[- ]level|technical[- ]debt" packages examples scripts -g '!**/dist/**' -g '!**/node_modules/**'
```

Docs and tests may still describe marker policy or unsupported provider behavior. Shipped source must not contain unfinished-work markers.

## Verification

Commands run locally on 2026-05-13:

```bash
pnpm capsule:gap
pnpm release:markers
pnpm release:audit
pnpm typecheck
pnpm test
pnpm build
pnpm docs:api
git diff --exit-code docs/api-reference.md
```

Results:

- `pnpm capsule:gap`: passed and produced adapter capability counts.
- `pnpm release:markers`: passed.
- `pnpm release:audit`: passed metadata audit, marker gate, and pack smoke for 20 public packages.
- `pnpm typecheck`: passed.
- `pnpm test`: passed with 22 test files passed and 11 skipped; 178 tests passed and 16 skipped.
- `pnpm build`: passed across 31 workspace projects.
- `pnpm docs:api`: passed.
- `git diff --exit-code docs/api-reference.md`: passed; generated API reference is current.

## What Is Real

- Core SDK contracts, domain facades, capability lookup, support-level negotiation, and unsupported capability errors.
- Policy evaluation, timeout merging, secret allowlist denial, redaction, and policy notes in receipts.
- Receipts with hashes, policy decisions, resource metadata, JSON schema, optional signing shape, and JSONL persistence.
- Docker CLI sandbox and job execution.
- Real adapter packages for E2B, Daytona, Modal, Cloud Run, Cloudflare Workers, Vercel, Neon, Kubernetes, Lambda, ECS/Fargate, EC2, Fly Machines, and Azure Container Apps.
- Preview orchestration with cleanup evidence and mock-provider production guardrails.
- CLI commands, AI helper, examples, docs, release checks, and live-test gates.

## What Is Mocked

`@capsule/adapter-mock` remains intentionally mocked for tests, examples, demos, and capability modeling. It is explicitly marked as mock metadata and is blocked from production preview plans when `requireRealProviders` is enabled unless the plan also allows mock providers.

Mock providers are not used to claim real provider support.

## Known Limitations

- Capsule is not a sandbox by itself; isolation depends on Docker/provider configuration.
- Live provider tests are skipped unless `CAPSULE_LIVE_TESTS=1` and provider-specific credentials are present.
- Some real adapters intentionally expose a narrow native slice and mark lifecycle depth, logs, source deploy, artifacts, or rollback as unsupported or experimental where provider coverage is incomplete.
- Receipts are observational records of what Capsule observed, not absolute proof of provider truth.
- Packages are not published to npm yet. Publishing still requires npm organization ownership, token, provenance, and first release review.
- Hosted persistence, auth, dashboard, billing, queues, and server APIs remain outside the SDK core by design.

## Suggested Next PRs

These are product expansion PRs, not hidden v2 readiness blockers:

1. Run credential-backed live provider smoke tests in a controlled account matrix.
2. Publish the first Changesets release after npm ownership and provenance checks.
3. Add deeper provider lifecycle APIs where provider APIs support logs, route aliases, revisions, rollbacks, and cleanup introspection.
4. Add receipt signing once a concrete key-management model is chosen.
5. Add official framework examples for Vercel AI SDK, OpenAI Agents, LangChain, Mastra, and CrewAI.
