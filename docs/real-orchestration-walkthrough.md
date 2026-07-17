# Real Provider Orchestration Walkthrough

This walkthrough composes one preview environment across three real providers in a single run:

- A **Neon** database branch for the preview's Postgres.
- A **Vercel** preview deployment for the web edge.
- A **Cloud Run** service for the API (optional; added only when Google credentials are present).

It builds on two references, read them first:

- [`examples/preview-environment-model`](../examples/preview-environment-model) is the runnable program this walkthrough drives. Its `livePlan` wires Neon, Vercel, and Cloud Run into one `PreviewPlan`.
- [`docs/real-provider-quickstarts.md`](./real-provider-quickstarts.md) documents each provider's credentials, cost risk, and cleanup in isolation.

Nothing here calls a provider until you set `CAPSULE_LIVE_TESTS=1` and the required credentials. Without them the same command runs in demo-only mock mode and calls no provider API.

## Safety before you start

- Capsule records what it requested and observed. It does not make a provider safe. Isolation, billing, IAM, networking, and cleanup stay with the underlying provider.
- Every step below creates real, potentially billable resources. The Neon branch and Cloud Run service persist until you delete them. Budget for that before running.
- Run this from a trusted environment. Do not run live provider operations in untrusted CI or forks.

## Step 1: Build the CLI and plan the run

Build the workspace CLI once, then use the planner to see exactly which env vars each provider needs. The planner never prints secret values.

```bash
pnpm install
pnpm --filter @capsule-sdk/cli build
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider neon
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider vercel
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider cloud-run
```

## Step 2: Set Neon credentials (database branch)

The preview creates a Neon branch as the first resource.

```bash
export NEON_API_KEY=...
export NEON_PROJECT_ID=...
export NEON_PARENT_BRANCH_ID=main
export NEON_DATABASE=neondb
export NEON_ROLE=neondb_owner
```

`NEON_API_KEY` and `NEON_PROJECT_ID` are required. `NEON_DATABASE` and `NEON_ROLE` are needed only when you want Capsule to retrieve a connection URI. See the Neon quickstart for the project-scoped `CAPSULE_POSTGRES_PROJECT_ID` alias.

## Step 3: Set Vercel credentials (web edge)

The preview deploys a Vercel preview target as the web edge.

```bash
export VERCEL_TOKEN=...
export VERCEL_PROJECT=...   # optional project scope
export VERCEL_TEAM_ID=...   # optional team scope
```

Only `VERCEL_TOKEN` is required. The example deploys an inline Worker module and targets `preview`.

## Step 4: Set Cloud Run credentials (API service, optional)

Cloud Run is added to the plan only when all three variables below are present. Skip this step to run a Neon + Vercel preview.

```bash
export GOOGLE_CLOUD_PROJECT=...
export GOOGLE_CLOUD_RUN_LOCATION=us-central1
export GOOGLE_OAUTH_ACCESS_TOKEN=...
```

The example uses `us-docker.pkg.dev/cloudrun/container/hello` as the default service image. Override it with `CAPSULE_EXAMPLE_SERVICE_IMAGE` when you want your own API image.

## Step 5: Enable live mode and run the orchestration

```bash
export CAPSULE_LIVE_TESTS=1
pnpm --filter @capsule-sdk/example-preview-environment-model start
```

The program:

1. Fails fast if `CAPSULE_LIVE_TESTS=1` is set but `NEON_API_KEY`, `NEON_PROJECT_ID`, or `VERCEL_TOKEN` is missing. The mock fallback is demo-only and cannot satisfy live verification.
2. Creates resources in order: database branch, then service (if Cloud Run is configured), then edge deployment.
3. Prints the preview graph, one create receipt per resource, and a reverse-order cleanup plan.
4. Runs `cleanupPreviewEnvironment` and prints cleanup receipts.

Resources are created in create order and cleaned up in reverse create order. Edge deployments have no cleanup action by design, so they resolve to an `unsupported` disposition rather than a failure.

## Step 6: Inspect and verify receipts

Every action writes a receipt to the JSONL store. The default path is `.capsule/receipts/preview-environment-model.jsonl`; override it with `CAPSULE_EXAMPLE_RECEIPTS_PATH`.

Verify the receipt chain with the CLI:

```bash
pnpm --filter @capsule-sdk/cli exec node dist/index.js receipt verify --receipt-file .capsule/receipts/preview-environment-model.jsonl
```

## Step 7: Confirm cleanup and reclaim leftovers

The example runs cleanup at the end, but two provider resources outlive the run by design:

- **Neon branch**: delete it with `capsule.database.branch.delete(...)` or in the Neon console. The database branch carries a TTL in its receipt but is not auto-deleted.
- **Cloud Run service**: delete it through Google Cloud tooling or a future Capsule lifecycle call.

Check both providers' consoles after the run to confirm nothing you did not intend is still running.

## Customizing the run

The example reads these optional overrides:

| Variable                              | Effect                                              |
| ------------------------------------- | --------------------------------------------------- |
| `CAPSULE_EXAMPLE_PREVIEW_NAME`        | Preview name (default `pr-42`).                     |
| `CAPSULE_EXAMPLE_BRANCH_NAME`         | Neon branch name.                                   |
| `CAPSULE_EXAMPLE_EDGE_NAME`           | Vercel deployment name.                             |
| `CAPSULE_EXAMPLE_SERVICE_NAME`        | Cloud Run service name.                             |
| `CAPSULE_EXAMPLE_SERVICE_IMAGE`       | Cloud Run service image.                            |
| `CAPSULE_EXAMPLE_RECEIPTS_PATH`       | Receipt store path.                                 |
| `CAPSULE_EXAMPLE_WAIT_FOR_OPERATIONS` | Set to `0` to skip waiting on Cloud Run operations. |

## Related docs

- [`docs/preview-environments.md`](./preview-environments.md) for the preview orchestration model.
- [`docs/execution-receipts.md`](./execution-receipts.md) for the receipt schema and verification.
- [`docs/live-tests.md`](./live-tests.md) for the live-test gate and CI safety rules.
