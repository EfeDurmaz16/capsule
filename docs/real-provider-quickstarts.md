# Real Provider Quickstarts

These quickstarts use real Capsule adapters. They are intentionally small and explicit about credentials, cleanup, and safety.

Do not run live provider operations from examples, scripts, or CI unless both conditions are true:

1. The provider credentials below are configured.
2. `CAPSULE_LIVE_TESTS=1` is set for that command.

Capsule adapters do not make a provider safe by themselves. Isolation, billing, network controls, IAM, and cleanup still depend on the underlying provider.

Use the CLI planner before running a live provider test. It maps provider names to required env vars, optional env vars, Stripe Projects aliases, and copy-safe commands without printing secret values:

```bash
pnpm --filter @capsule/cli capsule live-test plan
pnpm --filter @capsule/cli capsule live-test plan --provider neon
pnpm --filter @capsule/cli capsule live-test plan --provider cloudflare
```

## Docker

Install:

```bash
pnpm install
```

Run a local Docker job:

```bash
pnpm --filter @capsule/example-job-docker start
```

Run a local Docker sandbox:

```bash
pnpm --filter @capsule/example-sandbox-docker start
```

Credentials: none.

Cleanup: job containers are removed after `job.run`; sandbox examples destroy the container in `finally`.

Caveat: local Docker is not safe for hostile untrusted code by default. `network.mode = "none"` maps to Docker network isolation, but filesystem and host daemon access still require careful operator configuration.

## E2B

Set:

```bash
export E2B_API_KEY=...
export CAPSULE_LIVE_TESTS=1
```

Run the agent code execution example against E2B:

```bash
pnpm --filter @capsule/example-agent-code-execution start
```

Credentials: `E2B_API_KEY`.

Cleanup: the AI helper destroys the sandbox in `finally`; direct sandbox users should still call `destroy()`.

Caveat: isolation is provided by E2B, not Capsule. Capsule records receipts and policy notes for what it requested and observed.

## Daytona

Set:

```bash
export DAYTONA_API_KEY=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { daytona } from "@capsule/adapter-daytona";

const capsule = new Capsule({ adapter: daytona({ apiKey: process.env.DAYTONA_API_KEY }), receipts: true });
const sandbox = await capsule.sandbox.create({ name: "capsule-quickstart" });
try {
  const result = await sandbox.exec({ command: "echo hello from daytona" });
  console.log(result.stdout, result.receipt);
} finally {
  await sandbox.destroy();
}
```

Credentials: `DAYTONA_API_KEY`; optional adapter settings include API URL, target, and auto-stop controls.

Cleanup: call `sandbox.destroy()`. If you configure provider-side auto-stop, treat it as a backup, not the only cleanup path.

Caveat: workspace lifecycle and image/runtime semantics are provider-specific.

## Modal

Set:

```bash
export MODAL_TOKEN_ID=...
export MODAL_TOKEN_SECRET=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { modal } from "@capsule/adapter-modal";

const capsule = new Capsule({
  adapter: modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
    environment: process.env.MODAL_ENVIRONMENT
  }),
  receipts: true
});

const sandbox = await capsule.sandbox.create({ image: process.env.MODAL_IMAGE ?? "debian:bookworm-slim" });
try {
  const result = await sandbox.exec({ command: "echo hello from modal" });
  console.log(result.stdout, result.receipt);
} finally {
  await sandbox.destroy();
}
```

Credentials: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`; optional `MODAL_ENVIRONMENT` and `MODAL_IMAGE`.

Cleanup: call `sandbox.destroy()` to terminate the sandbox.

Caveat: Capsule currently models Modal sandboxes; broader Modal function/service workflows remain explicit future work.

## Neon

Set:

```bash
export NEON_API_KEY=...
export NEON_PROJECT_ID=...
export NEON_PARENT_BRANCH_ID=main
export NEON_DATABASE=neondb
export NEON_ROLE=neondb_owner
export CAPSULE_LIVE_TESTS=1
```

Run:

```bash
pnpm --filter @capsule/example-database-branch-model start
```

Credentials: `NEON_API_KEY`, `NEON_PROJECT_ID`. `NEON_DATABASE` and `NEON_ROLE` are required only when you want Capsule to retrieve a connection URI.

Stripe Projects alias: `CAPSULE_POSTGRES_PROJECT_ID` can be mapped to `NEON_PROJECT_ID` at command time. The planner includes the safe alias command:

```bash
pnpm --filter @capsule/cli capsule live-test plan --provider neon
```

Cleanup: delete the created branch with `capsule.database.branch.delete(...)` or in the Neon console. The example creates a branch and does not delete it automatically so you can inspect the receipt and resource.

Caveat: database branches can incur storage/compute cost. TTL is recorded in receipts when provided, but cleanup must be implemented by the caller or provider automation.

## Cloudflare Workers

Set:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_ZONE_ID=... # only needed when creating routes
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { cloudflare } from "@capsule/adapter-cloudflare";

const capsule = new Capsule({ adapter: cloudflare(), receipts: true });
const deployment = await capsule.edge.deploy({
  name: "capsule-worker",
  source: { path: "worker.js", entrypoint: "worker.js" },
  runtime: "workers"
});
console.log(deployment.url, deployment.receipt);

const version = await capsule.edge.version({
  name: "capsule-worker",
  source: { path: "worker.js", entrypoint: "worker.js" },
  runtime: "workers"
});

await capsule.edge.rollback({
  deploymentId: deployment.id,
  targetVersionId: version.id,
  providerOptions: { scriptName: "capsule-worker" }
});
```

Credentials: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; `CLOUDFLARE_ZONE_ID` when routes are requested.

Stripe Projects aliases: `CAPSULE_WORKER_API_TOKEN` can be mapped to `CLOUDFLARE_API_TOKEN`, and `CAPSULE_WORKER_ACCOUNT_ID` can be mapped to `CLOUDFLARE_ACCOUNT_ID`. The planner includes the safe alias command:

```bash
pnpm --filter @capsule/cli capsule live-test plan --provider cloudflare
```

Live verification: the default Cloudflare live test creates only an unreleased Worker version. Add `CAPSULE_CLOUDFLARE_LIVE_DEPLOY=1` when you intentionally want the same live test to call `edge.deploy` and update the named Worker script. Set `CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN` or map Stripe Projects' `CAPSULE_WORKER_WORKERS_DEV_SUBDOMAIN` when you want the receipt URL populated.

Cleanup: remove the Worker, routes, and bindings in Cloudflare or through future lifecycle APIs once implemented.

Caveat: routes, versions, and rollback use real Workers APIs. Rollback needs the Worker script name in `providerOptions.scriptName` because Cloudflare scopes deployments by script name rather than Capsule deployment id. Secret bindings, provider-specific bindings, logs, and gradual traffic-split release are still unsupported rather than faked. Plain `env` values are uploaded as Worker vars, not Cloudflare encrypted secrets.

## Cloud Run

Set one Google credential path:

```bash
export GOOGLE_CLOUD_PROJECT=...
export GOOGLE_CLOUD_RUN_LOCATION=us-central1
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# or GOOGLE_APPLICATION_CREDENTIALS_JSON=...
# or GOOGLE_OAUTH_ACCESS_TOKEN=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { cloudRun } from "@capsule/adapter-cloud-run";

const capsule = new Capsule({
  adapter: cloudRun({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_RUN_LOCATION
  }),
  receipts: true
});

const job = await capsule.job.run({
  name: "capsule-job",
  image: "us-docker.pkg.dev/cloudrun/container/hello"
});
console.log(job.status, job.receipt);
```

Credentials: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GOOGLE_OAUTH_ACCESS_TOKEN`, or an authenticated ADC environment; plus project and location.

Cleanup: Cloud Run job/service resources remain in the project unless you delete them through Google Cloud tooling or future Capsule lifecycle methods.

Caveat: IAM, public access, networking, logging, and billing are Google Cloud concerns delegated to Cloud Run.

## Vercel

Set:

```bash
export VERCEL_TOKEN=...
export VERCEL_TEAM_ID=... # optional
export VERCEL_PROJECT=... # optional
export CAPSULE_LIVE_TESTS=1
```

Run:

```bash
pnpm --filter @capsule/example-edge-model start
```

Credentials: `VERCEL_TOKEN`; optional team/project scoping through `VERCEL_TEAM_ID` and `VERCEL_PROJECT`.

Cleanup: remove preview deployments and aliases in Vercel. The example creates an inline preview deployment and does not auto-delete it.

Caveat: Capsule's first Vercel adapter uses inline deployment files. It supports bounded deployment event log reads and project runtime log reads when `projectId` is supplied; `follow` streaming is rejected. Large file upload/SHA flow, env mutation, domains, routes, and rollback are explicit future capabilities.

## Kubernetes

Set:

```bash
export KUBECONFIG=/path/to/kubeconfig
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { kubernetes } from "@capsule/adapter-kubernetes";

const capsule = new Capsule({ adapter: kubernetes({ namespace: "default" }), receipts: true });
const job = await capsule.job.run({
  name: "capsule-job",
  image: "busybox:1.36",
  command: ["sh", "-c", "echo hello from kubernetes"]
});
console.log(job.status, job.receipt);
```

Credentials: Kubernetes client configuration, usually `KUBECONFIG`, in-cluster config, or default kubeconfig discovery.

Cleanup: delete Jobs, Pods, Deployments, and Services in the target namespace. Capsule records resource IDs but does not yet provide full Kubernetes cleanup orchestration.

Caveat: cluster admission policies, network policies, namespaces, service accounts, and node isolation determine the real security boundary.

## Lambda

Set AWS credentials through the default AWS credential chain:

```bash
export AWS_PROFILE=...
# or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN
export AWS_REGION=us-east-1
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { lambda } from "@capsule/adapter-lambda";

const capsule = new Capsule({ adapter: lambda({ region: process.env.AWS_REGION }), receipts: true });
const run = await capsule.job.run({
  image: "ignored",
  name: "existing-function-name",
  command: JSON.stringify({ hello: "capsule" })
});
console.log(run.status, run.result?.stdout, run.receipt);
```

Credentials: `AWS_PROFILE`, static AWS keys, web identity, or another AWS SDK credential provider.

Cleanup: no Lambda function is created by this adapter path. It invokes an existing function, so cleanup is limited to logs, test payloads, and any side effects of the function itself.

Caveat: Capsule models existing Lambda invocation as `job.run`; function deployment, IAM mutation, and event-source configuration are not implemented.

## ECS/Fargate

Set AWS credentials through the default AWS credential chain:

```bash
export AWS_PROFILE=...
export AWS_REGION=us-east-1
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { ecs } from "@capsule/adapter-ecs";

const capsule = new Capsule({
  adapter: ecs({
    region: process.env.AWS_REGION,
    cluster: "capsule-cluster",
    subnets: ["subnet-..."],
    securityGroups: ["sg-..."]
  }),
  receipts: true
});

const run = await capsule.job.run({
  name: "capsule-task",
  image: "task-definition-family:revision"
});
console.log(run.status, run.receipt);
```

Credentials: AWS default credential chain plus region, cluster, networking, and existing task definition settings required by your ECS setup.

Cleanup: stopped one-shot tasks eventually disappear from active listings; services created by `service.deploy` must be deleted through ECS tooling or future lifecycle APIs.

Caveat: task definition registration, load balancers, IAM roles, logs, and service discovery are provider-specific and not faked.

## EC2

Set AWS credentials through the default AWS credential chain:

```bash
export AWS_PROFILE=...
export AWS_REGION=us-east-1
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule/core";
import { ec2 } from "@capsule/adapter-ec2";

const capsule = new Capsule({ adapter: ec2({ region: process.env.AWS_REGION }), receipts: true });
const machine = await capsule.machine.create({
  name: "capsule-machine",
  image: "ami-...",
  size: "t3.micro"
});
console.log(machine.status, machine.receipt);
```

Credentials: AWS default credential chain and region; `image` must be a valid AMI for that region.

Cleanup: terminate machines with `capsule.machine.destroy(...)` or EC2 tooling. Stopping is not the same as deleting and may still incur storage cost.

Caveat: machines are the leakiest Capsule primitive. Networking, security groups, AMIs, instance profiles, SSH/SSM access, EBS volumes, and cost controls should remain visible to the caller.
