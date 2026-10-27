# Preview Environments

A preview environment is a composition primitive.

Typical flow:

1. Create a database branch.
2. Deploy a web service or edge runtime.
3. Deploy an API service.
4. Run checks or jobs.
5. Collect logs and artifacts.
6. Return URLs.
7. Apply TTL, cost, and resource policy (see the TTL note below for what is enforced).
8. Cleanup.
9. Produce a preview receipt.

Capsule should let providers and framework maintainers model their preview orchestration honestly. Some providers expose previews natively; others require composition across multiple domains.

`@capsule-sdk/preview` is the composition package for the second case. It accepts explicit `Capsule` instances per resource, so an environment can combine a Neon branch, a Cloud Run service, a Cloudflare Worker, and a smoke-test job without pretending they share one provider model.

Production preview plans should set `requireRealProviders: true`. When that flag is enabled, `@capsule-sdk/preview` rejects adapters whose `raw()` escape hatch declares `{ mock: true }`. Demo and documentation flows can opt in to mock composition with `allowMockProviders: true`, but that mode is explicit and should never be treated as provider completion.

The package records a resource graph containing service, edge, database, and job resources. Cleanup walks that graph in reverse dependency order and reports partial cleanup failures instead of hiding successfully cleaned resources.

Every creation gets a unique run id from `createPreviewId` (name, time and a random component). The run id is not an idempotency key. Pass `operationId` on the plan to record a caller-stable identity, such as a pull request and commit, on the cleanup plan and the `preview.create` receipt; cleanup idempotency keys stay scoped to the run so one run's keys are never reused for another run's resources.

Preview status is aggregated from resource statuses. Any `failed`, `error`, `errored`, `crashed` or `cancelled` resource makes the preview `failed`, so a cancelled check never yields `ready`. `creating`, `pending`, `provisioning`, `queued` and `deploying` make it `creating`. A preview whose resources are all `deleted` is `deleted`. Everything else, including running services, a `running` job and resources without a status, is `ready`. A running job is not evidence that a check passed; callers that gate on checks should require each job's status to be `succeeded`.

Each created resource gets a graph-local `ref` (for example `resource-0`). The ref, not the provider-native id, is the join key between a resource, its cleanup action and its receipts, because native ids are not unique across providers or across projects of one provider. Cleanup plan actions record `resourceRef`, `resourceId`, `resourceProvider`, `resourceAdapter` and `resourceScope`, and each resource is always deleted through the Capsule that created it.

When a cleanup plan is passed to `cleanupPreviewEnvironment`, it is validated before the first delete. The plan must belong to the same preview, and each action must match its resource's kind, capability, provider, native id and cleanup identity (database project and branch, service id). Otherwise `PreviewCleanupPlanError` is thrown and nothing is deleted. Plans written before refs existed are accepted only when every action matches exactly one resource; ambiguous plans are rejected rather than guessed.

Cleanup evidence is explicit. Every resource gets a cleanup disposition:

- `cleaned`: Capsule invoked a cleanup action and the provider receipt reported deletion or did not expose a conflicting status.
- `partial`: Capsule invoked cleanup, but the provider receipt did not confirm a deleted terminal state.
- `unsupported`: the resource has no cleanup action in the current preview graph. Edge and job resources are unsupported by design because Capsule does not register a delete action for them.
- `leaked`: Capsule attempted cleanup and the provider operation failed, so the resource may still exist; or a cleanup approval resolver denied the cleanup, so no delete was sent and the resource still exists.

The cleanup result also carries an overall `status` derived from those dispositions:

- `cleaned`: every disposition is `cleaned`.
- `unsupported`: nothing failed, but at least one resource was left behind because its kind has no cleanup action by design (edge, job). This is not a failure.
- `partial`: at least one disposition is `partial` or `leaked`, meaning a real cleanup failure occurred.

### TTL

`PreviewPlan.ttlMs` is recorded, not enforced. It appears in the dry-run and `preview.create` receipt metadata as `ttl: { requestedMs, enforcement: "record-only" }`. `@capsule-sdk/preview` has no expiry controller or scheduler: nothing deletes the preview when the TTL passes, and the top-level value is not copied into child resource specs. Set `ttlEnforcement: "required"` when a preview must not be created without enforced expiry; creation then fails with `UnsupportedCapabilityError` (`preview.ttl`) before any provider call. A per-resource `ttlMs` (for example on a database branch spec) is checked against `policy.ttl.maxMs` by Capsule core; whether the provider expires the resource depends on the adapter, and the Neon adapter declares database TTL unsupported.

### Cleanup approval

When a Capsule policy requires approvals, the grant used to create a resource never authorizes its deletion; preview cleanup does not copy create grants into delete specs. Pass a resolver to obtain a fresh grant per cleanup action: `cleanupPreviewEnvironment(preview, resources, { approval })` or `createPreviewEnvironmentWithCleanup(plan, { cleanupApproval })`. The resolver receives `{ capabilityPath, resource, reason }`, where `resource` is exactly the scope Capsule core checks for that delete (`{ type: "database", project, id }` or `{ type: "service", id }`). Return a grant to send the delete with it, or `undefined` to deny; a denied cleanup sends no delete and is reported as `leaked` with an explanatory note. Without a resolver, deletes are sent without a grant, as before, and a policy that requires approval rejects them.

### Creation failures and the two create variants

`createPreviewGraph(...)` never cleans up by itself. If a provider call throws part-way, it throws `PreviewCreationError` carrying `resources` (the resources created before the failure, each bound to the Capsule that created it), a `cleanupPlan` for exactly those resources, and their provider `receipts`, plus the original error as `cause`. Recover with `cleanupPreviewEnvironment(error.preview, error.resources, { cleanupPlan: error.cleanupPlan })`; there is no need to rebuild provider identity. The resources live only in memory: a process that crashes before cleanup loses them, so a durable controller must persist each resource as it is created.

`createPreviewEnvironmentWithCleanup(...)` attempts cleanup when creation fails after earlier resources were provisioned, and reports it on `error.cleanup`. Neither variant cleans up a preview that was created without throwing but aggregates to `failed` (for example a failed or cancelled check job); the caller decides. The cleanup result includes underlying provider receipts plus an orchestration-level `preview.cleanup` receipt from `@capsule-sdk/preview`. That receipt summarizes the cleanup status and per-resource dispositions. Provider receipts remain the strongest evidence for what happened at each provider; preview orchestration does not claim provider-native preview support unless an adapter exposes it.

## CLI

The CLI can run the same composition model from a JSON config file and persist a serializable cleanup plan:

```bash
capsule preview create --config-file preview.json --cleanup-file .capsule/preview-cleanup.json
capsule preview destroy --cleanup-file .capsule/preview-cleanup.json
```

Minimal config:

```json
{
  "name": "pr-70",
  "requireRealProviders": true,
  "allowMockProviders": true,
  "databases": [
    {
      "adapter": "mock-neon",
      "spec": {
        "project": "app",
        "name": "pr-70-db"
      }
    }
  ]
}
```

Each resource entry has an `adapter`, optional adapter `options`, and a domain spec. Supported top-level arrays are `databases`, `services`, `edges`, and `jobs`. Real provider configs use the same adapter names as the rest of the CLI, for example `neon`, `cloud-run`, `cloudflare`, `vercel`, `kubernetes`, `ecs`, or `azure-container-apps`.

The cleanup file uses schema `capsule.preview.cleanup.v1`. It stores the preview identity, resource graph, cleanup capability path, adapter name, adapter options, and cleanup spec. It does not serialize `Capsule` instances or provider clients, and database connection strings are not written into the cleanup plan.

`preview destroy` rebuilds the required Capsule instances from the recorded cleanup actions, walks the resource graph in reverse order through `@capsule-sdk/preview`, and prints cleanup dispositions plus a summary that counts `cleaned`, `partial`, `failed`, `unsupported`, and `leaked` resources. It exits non-zero only for a real failure (overall status `partial`). A run whose only leftovers are by-design-unsupported kinds (edge, job) reports status `unsupported` and exits 0; the dispositions explain what was left behind and why.

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
pnpm --filter @capsule-sdk/example-preview-environment-model start
```

Run live verification only after choosing the provider resources it will create:

```bash
export CAPSULE_LIVE_TESTS=1
export NEON_API_KEY=...
export NEON_PROJECT_ID=...
export VERCEL_TOKEN=...
pnpm --filter @capsule-sdk/example-preview-environment-model start
```
