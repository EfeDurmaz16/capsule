# Preview Environments

A preview environment is a composition primitive.

Typical flow:

1. Create a database branch.
2. Deploy a web service or edge runtime.
3. Deploy an API service.
4. Run checks or jobs.
5. Collect logs and artifacts.
6. Return URLs.
7. Enforce TTL, cost, and resource policy.
8. Cleanup.
9. Produce a preview receipt.

Capsule should let providers and framework maintainers model their preview orchestration honestly. Some providers expose previews natively; others require composition across multiple domains.

`@capsule/preview` is the composition package for the second case. It accepts explicit `Capsule` instances per resource, so an environment can combine a Neon branch, a Cloud Run service, a Cloudflare Worker, and a smoke-test job without pretending they share one provider model.

Production preview plans should set `requireRealProviders: true`. When that flag is enabled, `@capsule/preview` rejects adapters whose `raw()` escape hatch declares `{ mock: true }`. Demo and documentation flows can opt in to mock composition with `allowMockProviders: true`, but that mode is explicit and should never be treated as provider completion.

The package records a resource graph containing service, edge, database, and job resources. Cleanup walks that graph in reverse dependency order and reports partial cleanup failures instead of hiding successfully cleaned resources.

Cleanup evidence is explicit. Every resource gets a cleanup disposition:

- `cleaned`: Capsule invoked a cleanup action and the provider receipt reported deletion or did not expose a conflicting status.
- `partial`: Capsule invoked cleanup, but the provider receipt did not confirm a deleted terminal state.
- `unsupported`: the resource has no cleanup action in the current preview graph.
- `leaked`: Capsule attempted cleanup and the provider operation failed, so the resource may still exist.

`createPreviewEnvironmentWithCleanup(...)` attempts cleanup when creation fails after earlier resources were provisioned. The cleanup result includes underlying provider receipts plus an orchestration-level `preview.cleanup` receipt from `@capsule/preview`. That receipt summarizes the cleanup status and per-resource dispositions. Provider receipts remain the strongest evidence for what happened at each provider; preview orchestration does not claim provider-native preview support unless an adapter exposes it.

## Example

`examples/preview-environment-model` demonstrates both modes without blurring them:

- default mode is demo-only and uses mock adapters;
- demo mode sets `allowMockProviders: true`;
- live mode requires `CAPSULE_LIVE_TESTS=1`, `NEON_API_KEY`, `NEON_PROJECT_ID`, and `VERCEL_TOKEN`;
- Cloud Run service composition is added only when `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_RUN_LOCATION`, and `GOOGLE_OAUTH_ACCESS_TOKEN` are also present;
- live mode fails instead of falling back to mocks when required credentials are missing.

The example persists receipts to `.capsule/receipts/preview-environment-model.jsonl` by default and prints only receipt summaries: id, type, provider, adapter, capability path, support level, and resource status. It intentionally does not print receipt metadata or provider options, so cleanup output does not expose connection strings or credential-shaped fields.

Run the demo path:

```bash
pnpm --filter @capsule/example-preview-environment-model start
```

Run live verification only after choosing the provider resources it will create:

```bash
export CAPSULE_LIVE_TESTS=1
export NEON_API_KEY=...
export NEON_PROJECT_ID=...
export VERCEL_TOKEN=...
pnpm --filter @capsule/example-preview-environment-model start
```
