# Capsule V2 Plan

Date: 2026-05-13

V2 is the production-hardening layer after the v1 foundation. The rule is strict: no issue can be closed by replacing a real integration with a mock, stub, TODO, or vague "planned" claim.

Mock adapters remain allowed only for tests, examples, and contract modeling. They cannot be used as completion evidence for a real provider issue.

## V2 Scope Rules

- A provider feature is shipped only when it calls a real provider API, official SDK, local runtime, or documented runtime command.
- Unsupported behavior is acceptable only when the capability map says `unsupported`, tests guard against accidental support, and docs explain why.
- Experimental behavior must still be real behavior. It may be narrow, provider-specific, or incomplete, but it must not be fake.
- Live-provider verification must stay opt-in behind `CAPSULE_LIVE_TESTS=1` and provider credentials.
- No credentials, connection strings, private keys, or raw provider tokens may appear in receipts, logs, errors, examples, or issue comments.
- Every issue must land through an atomic branch, PR, CI, review/check, and merge.

## Execution Workflow

1. Create a scoped issue for each provider, package, or release surface.
2. Land each change through an atomic branch, PR, CI check, review, and merge.
3. Keep live provider verification credential-gated and documented.
4. Re-run the final readiness audit after all v2 issues close.

## V2 Workstreams

### Provider Lifecycle Depth

Close narrow lifecycle gaps in real adapters: logs, status, cancel/delete, route/alias, rollback, machine snapshots, and cleanup receipts. Each provider issue must include request-mapping tests and docs.

Priority providers for this layer are Cloud Run logs/revisions, Azure Container Apps status/delete/cancel/revisions, Vercel alias rollback/logs, Cloudflare Worker versions/rollback/secrets, and Kubernetes pod logs. Before implementing provider API work, verify current official provider docs for logs, revisions, deletion, and rollback semantics.

### Real Verification

Add opt-in live smoke tests for real providers. These must skip cleanly by default, describe missing credentials, and clean up provider resources on failure.

### Preview Productionization

Make preview orchestration rely on real providers when credentials are present, persist cleanup receipts, and report partial cleanup failures without hiding them.

Preview v2 also needs lifecycle parity with its capability map. `preview.create` alone is not enough if the adapter declares `destroy`, `status`, `logs`, `urls`, `ttl`, or `cleanup`. Unsupported preview methods must fail loudly.

### Receipt And Evidence Hardening

Strengthen receipt persistence, redaction tests, provider request IDs, idempotency keys, and optional signing without turning core into a database-backed server.

Receipt persistence must be explicit. Best-effort mode can continue after a store failure, but required mode must fail closed so users know whether evidence was actually durable.

### Release Readiness

Finish npm publication readiness, package docs, changelog flow, and post-publish badges only after packages are actually published.

Release readiness includes package metadata, `npm pack` dry runs, install/import smoke tests, and a gate for unfinished-source markers. A package is not publish-ready merely because `tsup` can build it.

## Completion Criteria

V2 is complete when:

- all v2 GitHub issues are closed by merged PRs;
- `pnpm capsule:gap`, `pnpm docs:api`, `pnpm release:audit`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass;
- open PR list is empty;
- open `capsule` issue list is empty or contains only explicitly out-of-scope future issues without `needs-verification`;
- `rg "TODO|FIXME|stub|mock level|technical debt"` returns no shipped-source debt markers;
- docs distinguish real, unsupported, experimental, and mock-only surfaces.
