# Live Provider Tests

Capsule live tests are skipped by default. They run only when `CAPSULE_LIVE_TESTS=1` and the provider-specific environment variables for that test are present.

Do not enable these tests in routine CI without dedicated test accounts, quotas, and cleanup monitoring. Several tests create real provider resources.

`@capsule/test-utils` exports `liveProviderRegistry` and `liveProviderCredentials` for all real adapters: Docker, E2B, Daytona, Modal, Cloud Run, Cloudflare, Vercel, Neon, Kubernetes, Lambda, ECS, EC2, Fly, and Azure Container Apps. `@capsule/adapter-mock` is deliberately excluded because mock success is not live provider verification.

| Provider | Test path | Required environment | Operation | Cleanup |
| --- | --- | --- | --- | --- |
| Cloud Run | `packages/adapter-cloud-run/src/cloud-run.live.test.ts` | `CAPSULE_LIVE_TESTS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_RUN_LOCATION`, `GOOGLE_OAUTH_ACCESS_TOKEN`, `CAPSULE_CLOUD_RUN_SERVICE_ID` | Reads an existing service status. | No resource is created. |
| Cloudflare | `packages/adapter-cloudflare/src/cloudflare.live.test.ts` | `CAPSULE_LIVE_TESTS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CAPSULE_CLOUDFLARE_WORKER_NAME`, `CAPSULE_CLOUDFLARE_LIVE_CREATE_VERSION` | Creates an unreleased Worker version. | No route is released; remove Worker versions from Cloudflare if your account policy requires it. |
| Vercel | `packages/adapter-vercel/src/vercel.live.test.ts` | `CAPSULE_LIVE_TESTS`, `VERCEL_TOKEN`, `CAPSULE_VERCEL_DEPLOYMENT_ID` | Reads an existing deployment status. | No resource is created. |
| Neon | `packages/adapter-neon/src/neon.live.test.ts` | `CAPSULE_LIVE_TESTS`, `NEON_API_KEY`, `NEON_PROJECT_ID` | Creates a branch. | Deletes the branch with `hardDelete: true` in `finally`. |
| Kubernetes | `packages/adapter-kubernetes/src/kubernetes.live.test.ts` | `CAPSULE_LIVE_TESTS`, `CAPSULE_KUBERNETES_NAMESPACE` | Creates a Job in the configured namespace. | Deletes the Job in `finally`. |
| AWS Lambda | `packages/adapter-lambda/src/lambda.live.test.ts` | `CAPSULE_LIVE_TESTS`, `AWS_REGION`, `CAPSULE_LAMBDA_FUNCTION_NAME` | Invokes an existing Lambda function. | No resource is created; side effects depend on the function. |
| Fly Machines | `packages/adapter-fly/src/fly.live.test.ts` | `CAPSULE_LIVE_TESTS`, `FLY_API_TOKEN`, `FLY_APP_NAME`, `CAPSULE_FLY_IMAGE` | Creates a Machine. | Destroys the Machine in `finally`. |
| Azure Container Apps | `packages/adapter-azure-container-apps/src/azure-container-apps.live.test.ts` | `CAPSULE_LIVE_TESTS`, `AZURE_ACCESS_TOKEN`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `AZURE_CONTAINERAPPS_ENVIRONMENT_ID`, `CAPSULE_AZURE_CONTAINER_IMAGE` | Deploys a Container App service. | Deletes the service in `finally`. |

Optional environment:

- `NEON_PARENT_BRANCH_ID`, `NEON_DATABASE`, `NEON_ROLE`, `NEON_POOLED`
- `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_PROJECT_ID`
- `CLOUDFLARE_COMPATIBILITY_DATE`
- `KUBECONFIG`, `KUBECONFIG_CONTEXT`, `CAPSULE_KUBERNETES_IMAGE`
- `FLY_REGION`, `CAPSULE_FLY_MEMORY_MB`, `CAPSULE_FLY_CPUS`
- `CAPSULE_AZURE_CONTAINER_PORT`

Run all credential-gated tests:

```bash
CAPSULE_LIVE_TESTS=1 pnpm test
```

Run a single provider:

```bash
CAPSULE_LIVE_TESTS=1 pnpm vitest run packages/adapter-neon/src/neon.live.test.ts
```
