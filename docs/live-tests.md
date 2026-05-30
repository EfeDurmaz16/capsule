# Live Provider Tests

Capsule live tests are skipped by default. They run only when `CAPSULE_LIVE_TESTS=1` and the provider-specific environment variables for that test are present.

Do not enable these tests in routine CI without dedicated test accounts, quotas, and cleanup monitoring. Several tests create real provider resources.

`@capsule/test-utils` exports `liveProviderRegistry` and `liveProviderCredentials` for all real adapters: Docker, E2B, Daytona, Modal, Cloud Run, Cloudflare, Vercel, Neon, Kubernetes, Lambda, ECS, EC2, Fly, and Azure Container Apps. `@capsule/adapter-mock` is deliberately excluded because mock success is not live provider verification.

Before exporting credentials, use the CLI planner to inspect the required env-var names and the provider-specific Vitest command:

```bash
pnpm --filter @capsule/cli capsule live-test plan
pnpm --filter @capsule/cli capsule live-test plan --provider neon
pnpm --filter @capsule/cli capsule live-test plan --provider cloudflare
```

The planner prints only env-var names, project-scoped aliases, notes, and copy-safe commands. It does not read or print secret values.

Use the verification matrix before running live tests:

```bash
pnpm --filter @capsule/cli capsule verify providers
pnpm --filter @capsule/cli capsule verify providers --provider neon
node scripts/live-test-matrix.mjs --dry-run
node scripts/live-test-matrix.mjs --dry-run --provider neon
```

The CLI provider matrix reports Docker availability and provider credential readiness. The `live-test-matrix.mjs` dry run does not create resources or invoke provider APIs; it reports which live tests would run for the current environment, which env-var names are configured or missing, cost acknowledgement status, the live test path, and the safe command to run when you intentionally opt in with `CAPSULE_LIVE_TESTS=1`.

Before running a provider live test, validate the exact provider environment:

```bash
pnpm --filter @capsule/cli capsule live-test validate --provider neon
pnpm --filter @capsule/cli capsule live-test validate --provider fly
```

The validator is side-effect-free. It checks `CAPSULE_LIVE_TESTS`, required credential/project/region env vars, provider-scoped aliases, and billable-test acknowledgement. Live tests that create resources or invoke billable provider work report `blocked` until `CAPSULE_LIVE_TEST_COST_ACK=1` is set. Read-only status checks, such as Vercel deployment status and Cloud Run service status, do not require that acknowledgement.

## Live Resource Metadata

Mutating live tests use deterministic names and portable metadata from `@capsule/test-utils`:

- Name shape: `capsule-live-<provider>-<resource>-<run-id>`, truncated with a stable hash when a provider has shorter name limits.
- Labels/tags: `capsule_live_test`, `capsule_managed_by`, `capsule_owner`, `capsule_repo`, `capsule_provider`, `capsule_resource`, `capsule_run_id`, `capsule_ttl_ms`, and `capsule_expires_at`.
- TTL: metadata defaults to 60 minutes. Neon keeps its 30 minute branch TTL input unless `CAPSULE_LIVE_TEST_TTL_MS` overrides it.

Optional metadata environment:

- `CAPSULE_LIVE_TEST_OWNER`: owner label; falls back to `GITHUB_ACTOR`, `USER`, then `local`.
- `CAPSULE_LIVE_TEST_REPO`: repo label; falls back to `GITHUB_REPOSITORY`, then `capsule`.
- `CAPSULE_LIVE_TEST_RUN_ID`: deterministic run scope; falls back to `GITHUB_RUN_ID` plus `GITHUB_RUN_ATTEMPT`, `CI_PIPELINE_ID`, `BUILD_ID`, then `local`.
- `CAPSULE_LIVE_TEST_TTL_MS`: positive integer TTL override.

Provider coverage is intentionally explicit. E2B receives labels as sandbox metadata, Daytona receives labels in create params, Azure Container Apps maps labels to ARM tags, Kubernetes maps labels onto Jobs, and Fly Machines stores labels in Machine config metadata. Neon records labels and TTL in Capsule receipts, while Neon provider-side TTL enforcement is not implemented by the current adapter. Cloudflare Worker tests keep the existing env-provided Worker name and record labels in Capsule receipts only. Modal currently uses deterministic names, but its adapter does not map labels to a provider metadata field. Cloud Run, Vercel, and Lambda tests operate on existing resources and do not create taggable live resources.

| Provider | Test path | Required environment | Operation | Cleanup |
| --- | --- | --- | --- | --- |
| E2B | `packages/adapter-e2b/src/e2b.live.test.ts` | `CAPSULE_LIVE_TESTS`, `E2B_API_KEY` | Creates a sandbox, exercises exec and file operations. | Destroys the sandbox in `finally`. |
| Daytona | `packages/adapter-daytona/src/daytona.live.test.ts` | `CAPSULE_LIVE_TESTS`, `DAYTONA_API_KEY` | Creates an ephemeral sandbox, exercises exec and file operations. | Destroys the sandbox in `finally`; provider-side auto-stop is a backup, not the primary cleanup path. |
| Modal | `packages/adapter-modal/src/modal.live.test.ts` | `CAPSULE_LIVE_TESTS`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Creates a Modal sandbox, exercises exec and file operations, and verifies unsupported file listing. | Destroys the sandbox in `finally`. |
| Cloud Run | `packages/adapter-cloud-run/src/cloud-run.live.test.ts` | `CAPSULE_LIVE_TESTS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_RUN_LOCATION`, `GOOGLE_OAUTH_ACCESS_TOKEN`, `CAPSULE_CLOUD_RUN_SERVICE_ID` | Reads an existing service status. | No resource is created. |
| Cloudflare | `packages/adapter-cloudflare/src/cloudflare.live.test.ts` | `CAPSULE_LIVE_TESTS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CAPSULE_CLOUDFLARE_WORKER_NAME`, `CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION`; set `CAPSULE_CLOUDFLARE_LIVE_DEPLOY=1` for the deploy smoke and `CAPSULE_CLOUDFLARE_LIVE_ROLLBACK=1` for rollback smoke | Creates an unreleased Worker version by default; deploys a Worker script or creates a rollback deployment only behind explicit flags. | No route is released; deploy and rollback smokes update the named Worker script/deployment. Remove Worker versions/scripts from Cloudflare if your account policy requires it. |
| Vercel | `packages/adapter-vercel/src/vercel.live.test.ts` | `CAPSULE_LIVE_TESTS`, `VERCEL_TOKEN`, `CAPSULE_VERCEL_DEPLOYMENT_ID` | Reads an existing deployment status. | No resource is created. |
| Neon | `packages/adapter-neon/src/neon.live.test.ts` | `CAPSULE_LIVE_TESTS`, `NEON_API_KEY`, `NEON_PROJECT_ID` | Creates a branch and optionally retrieves its connection URI when `NEON_DATABASE` and `NEON_ROLE` are set. | Deletes the branch with `hardDelete: true` in `finally`. |
| Kubernetes | `packages/adapter-kubernetes/src/kubernetes.live.test.ts` | `CAPSULE_LIVE_TESTS`, `CAPSULE_KUBERNETES_NAMESPACE` | Creates a Job in the configured namespace. | Deletes the Job in `finally`. |
| AWS Lambda | `packages/adapter-lambda/src/lambda.live.test.ts` | `CAPSULE_LIVE_TESTS`, `AWS_REGION`, `CAPSULE_LAMBDA_FUNCTION_NAME` | Invokes an existing Lambda function. | No resource is created; side effects depend on the function. |
| Fly Machines | `packages/adapter-fly/src/fly.live.test.ts` | `CAPSULE_LIVE_TESTS`, `FLY_API_TOKEN`, `FLY_APP_NAME`, `CAPSULE_FLY_IMAGE` | Creates a Machine. | Destroys the Machine in `finally`. |
| Azure Container Apps | `packages/adapter-azure-container-apps/src/azure-container-apps.live.test.ts` | `CAPSULE_LIVE_TESTS`, `AZURE_ACCESS_TOKEN`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `AZURE_CONTAINERAPPS_ENVIRONMENT_ID`, `CAPSULE_AZURE_CONTAINER_IMAGE` | Deploys a Container App service. | Deletes the service in `finally`. |

Optional environment:

- `MODAL_APP_NAME`, `MODAL_IMAGE`, `MODAL_ENVIRONMENT`
- `NEON_PARENT_BRANCH_ID`, `NEON_DATABASE`, `NEON_ROLE`, `NEON_POOLED`
- `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_PROJECT_ID`
- `CLOUDFLARE_COMPATIBILITY_DATE`, `CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN`, `CAPSULE_CLOUDFLARE_LIVE_DEPLOY`, `CAPSULE_CLOUDFLARE_LIVE_ROLLBACK`
- `KUBECONFIG`, `KUBECONFIG_CONTEXT`, `CAPSULE_KUBERNETES_IMAGE`
- `FLY_REGION`, `CAPSULE_FLY_MEMORY_MB`, `CAPSULE_FLY_CPUS`
- `CAPSULE_AZURE_CONTAINER_PORT`

Run all credential-gated tests only after the validator reports `ready` for the providers you intend to exercise:

```bash
CAPSULE_LIVE_TESTS=1 pnpm test
```

Run a single provider:

```bash
CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-neon/src/neon.live.test.ts
```

Ask the CLI for the canonical command when in doubt:

```bash
pnpm --filter @capsule/cli capsule live-test plan --provider vercel
```

## Project-Scoped Env Mapping

Local project vaults may expose credentials with resource-scoped names. Keep those names local and map them to Capsule's canonical live-test variables at command time:

```bash
set -a
. ./.env
set +a

NEON_PROJECT_ID="${NEON_PROJECT_ID:-$CAPSULE_POSTGRES_PROJECT_ID}" \
NEON_DATABASE="${NEON_DATABASE:-$CAPSULE_POSTGRES_DATABASE_NAME}" \
CAPSULE_LIVE_TESTS=1 \
pnpm vitest run packages/adapter-neon/src/neon.live.test.ts

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CAPSULE_WORKER_API_TOKEN}" \
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CAPSULE_WORKER_ACCOUNT_ID}" \
CAPSULE_CLOUDFLARE_WORKER_NAME="capsule-worker" \
CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION=1 \
CAPSULE_LIVE_TESTS=1 \
pnpm vitest run packages/adapter-cloudflare/src/cloudflare.live.test.ts

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CAPSULE_WORKER_API_TOKEN}" \
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CAPSULE_WORKER_ACCOUNT_ID}" \
CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN="${CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN:-$CAPSULE_WORKER_WORKERS_DEV_SUBDOMAIN}" \
CAPSULE_CLOUDFLARE_WORKER_NAME="capsule-worker" \
CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION=1 \
CAPSULE_CLOUDFLARE_LIVE_DEPLOY=1 \
CAPSULE_LIVE_TESTS=1 \
pnpm vitest run packages/adapter-cloudflare/src/cloudflare.live.test.ts

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$CAPSULE_WORKER_API_TOKEN}" \
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$CAPSULE_WORKER_ACCOUNT_ID}" \
CAPSULE_CLOUDFLARE_WORKER_NAME="capsule-worker" \
CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION=1 \
CAPSULE_CLOUDFLARE_LIVE_ROLLBACK=1 \
CAPSULE_LIVE_TESTS=1 \
pnpm vitest run packages/adapter-cloudflare/src/cloudflare.live.test.ts
```

The same mappings are included in `capsule live-test plan --provider neon` and `capsule live-test plan --provider cloudflare`.

Do not commit `.env`, `.projects/`, local project vault files, or live-test logs that include provider IDs, tokens, connection strings, or account URLs.
