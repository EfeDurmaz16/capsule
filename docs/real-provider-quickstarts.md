# Real Provider Quickstarts

These quickstarts use real Capsule adapters. They are intentionally small and explicit about credentials, cleanup, and safety.

Do not run live provider operations from examples, scripts, or CI unless both conditions are true:

1. The provider credentials below are configured.
2. `CAPSULE_LIVE_TESTS=1` is set for that command.

Capsule adapters do not make a provider safe by themselves. Isolation, billing, network controls, IAM, and cleanup still depend on the underlying provider.

Build the workspace CLI once, then use the planner before running a live provider test. It maps provider names to required env vars, optional env vars, project-scoped aliases, and copy-safe commands without printing secret values:

```bash
pnpm --filter @capsule-sdk/cli build
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider neon
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider cloudflare
```

## Docker

Status badges: [credentials: none] [cost risk: local Docker resources] [capabilities: sandbox native, job native] [cleanup: job auto-remove, sandbox destroy]

Install:

```bash
pnpm install
```

Run a local Docker sandbox:

```bash
pnpm --filter @capsule-sdk/example-sandbox-docker start
```

Run a local Docker sandbox:

```bash
pnpm --filter @capsule-sdk/example-sandbox-docker start
```

Credentials: none.

Cleanup: job containers are removed after `job.run`; sandbox examples destroy the container in `finally`.

Caveat: local Docker is not safe for hostile untrusted code by default. `network.mode = "none"` maps to Docker network isolation, but filesystem and host daemon access still require careful operator configuration.

## E2B

Status badges: [credentials: E2B_API_KEY] [cost risk: cloud sandbox runtime] [capabilities: sandbox native] [cleanup: sandbox.destroy]

Set:

```bash
export E2B_API_KEY=...
export CAPSULE_LIVE_TESTS=1
```

Run the agent code execution example against E2B:

```bash
pnpm --filter @capsule-sdk/example-agent-code-execution start
```

Credentials: `E2B_API_KEY`.

Cleanup: the AI helper destroys the sandbox in `finally`; direct sandbox users should still call `destroy()`. If sandbox creation succeeds and a later local adapter step fails, Capsule attempts `sandbox.kill()` and attaches cleanup metadata to the original error. A command that exits nonzero is a normal `ExecResult` and the sandbox is kept. A refused exec request (auth, validation, rate limit) keeps its typed provider error; any other exec failure rejects with `UnknownOutcomeError` and the sandbox is kept, because the command may have run.

Limits: `ExecSpec.input` is rejected with `UnsupportedCapabilityError` before any provider call. Artifacts and streaming logs are unsupported; port exposure is experimental.

Caveat: isolation is provided by E2B, not Capsule. Capsule records receipts and policy notes for what it requested and observed.

## Daytona

Status badges: [credentials: DAYTONA_API_KEY] [cost risk: workspace runtime and storage] [capabilities: sandbox native] [cleanup: sandbox.destroy, auto-stop as backup]

Set:

```bash
export DAYTONA_API_KEY=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { daytona } from "@capsule-sdk/daytona";

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

Cleanup: call `sandbox.destroy()`. If you configure provider-side auto-stop, treat it as a backup, not the only cleanup path. If sandbox creation succeeds and a later local adapter step fails, Capsule attempts sandbox deletion and attaches cleanup metadata to the original error. An exec failure no longer deletes the workspace: a refused request keeps its typed provider error, any other failure rejects with `UnknownOutcomeError` carrying the sandbox locator.

Limits: `ExecSpec.input` is rejected before any provider call. `network.allowedHosts` accepts IPv4/IPv6 CIDR entries only; a domain entry is rejected with `PolicyViolationError`, and an empty allowlist blocks all egress. Artifacts and snapshot are unsupported.

Caveat: workspace lifecycle and image/runtime semantics are provider-specific.

## Modal

Status badges: [credentials: MODAL_TOKEN_ID and MODAL_TOKEN_SECRET] [cost risk: sandbox runtime] [capabilities: sandbox native without file listing] [cleanup: sandbox.destroy]

Set:

```bash
export MODAL_TOKEN_ID=...
export MODAL_TOKEN_SECRET=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { modal } from "@capsule-sdk/modal";

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

Cleanup: call `sandbox.destroy()` to terminate the sandbox. Capsule calls `terminate({ wait: true })` and writes the destroy receipt only after the sandbox is observed terminal. If that takes longer than `terminateDeadlineMs` (default 60000) the call throws `PendingOperationError` and writes no receipt; if termination fails the provider error is propagated. Inspect the Modal dashboard before assuming cleanup completed in either case. If receipt signing fails after create, Capsule terminates the new sandbox and throws `PartialEffectsError` (or `CleanupFailureError` when termination failed).

Caveat: Capsule currently models Modal sandboxes; file listing, artifacts, streaming logs, snapshot, port exposure and broader Modal function/service workflows remain explicit future work. `ExecSpec.input` is written to stdin followed by EOF. `network.allowedHosts` accepts CIDR entries only; domain entries are rejected and an empty allowlist blocks all egress. Modal receipts include app/image/network metadata for create, text-mode execution metadata for exec, and terminate semantics for destroy.

## Neon

Status badges: [credentials: NEON_API_KEY and NEON_PROJECT_ID] [cost risk: branch storage and compute] [capabilities: database native] [cleanup: database.branch.delete or Neon console]

Set:

```bash
export NEON_API_KEY=...
export NEON_PROJECT_ID=...
export NEON_PARENT_BRANCH_ID=main
export NEON_DATABASE=neondb
export NEON_ROLE=neondb_owner
export CAPSULE_LIVE_TESTS=1
```

Inspect the declared capabilities:

```bash
pnpm --filter @capsule-sdk/cli exec node dist/index.js capabilities --adapter neon
```

Credentials: `NEON_API_KEY`, `NEON_PROJECT_ID`. `NEON_DATABASE` and `NEON_ROLE` are required only when you want Capsule to retrieve a connection URI.

Project-scoped alias: `CAPSULE_POSTGRES_PROJECT_ID` can be mapped to `NEON_PROJECT_ID` at command time. The planner includes the safe alias command:

```bash
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider neon
```

Cleanup: delete the created branch with `capsule.database.branch.delete(...)` or in the Neon console. The example creates a branch and does not delete it automatically so you can inspect the receipt and resource.

Caveat: database branches can incur storage/compute cost. TTL is recorded in receipts when provided, but cleanup must be implemented by the caller or provider automation. A new or reset branch reports `creating` or `resetting` until Neon reports it ready with no pending state or running operation; operation ids are in the receipt metadata. Client options `requestTimeoutMs` (default 60000) and `maxResponseBytes` (default 16 MiB) bound every request.

## Cloudflare Workers

Status badges: [credentials: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID] [cost risk: Worker versions, scripts, and routes] [capabilities: edge native] [cleanup: Cloudflare console or future lifecycle APIs]

Set:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_ZONE_ID=... # only needed when creating routes
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { cloudflare } from "@capsule-sdk/cloudflare";

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

Project-scoped aliases: `CAPSULE_WORKER_API_TOKEN` can be mapped to `CLOUDFLARE_API_TOKEN`, and `CAPSULE_WORKER_ACCOUNT_ID` can be mapped to `CLOUDFLARE_ACCOUNT_ID`. The planner includes the safe alias command:

```bash
pnpm --filter @capsule-sdk/cli exec node dist/index.js live-test plan --provider cloudflare
```

Live verification: the default Cloudflare live test creates only an unreleased Worker version. Add `CAPSULE_CLOUDFLARE_LIVE_DEPLOY=1` when you intentionally want the same live test to call `edge.deploy` and update the named Worker script. Add `CAPSULE_CLOUDFLARE_LIVE_ROLLBACK=1` when you intentionally want it to create a Worker deployment that moves traffic to a freshly uploaded version. Set `CAPSULE_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN` or map local `CAPSULE_WORKER_WORKERS_DEV_SUBDOMAIN` when you want the receipt URL populated.

Cleanup: remove the Worker, routes, and bindings in Cloudflare or through future lifecycle APIs once implemented. If a route fails after upload, Capsule deletes the routes it created, never the Worker, and throws `PartialEffectsError` (or `CleanupFailureError` when a route delete failed) naming the Worker and routes; the original error is the `cause`. Implicit rollback requires the previous deployment to route 100% to one version; a traffic split needs an explicit target version.

Caveat: routes, versions, and rollback use real Workers APIs. Rollback needs the Worker script name in `providerOptions.scriptName` because Cloudflare scopes deployments by script name rather than Capsule deployment id. Secret bindings, provider-specific bindings, logs, and gradual traffic-split release are still unsupported rather than faked. Plain `env` values are uploaded as Worker vars, not Cloudflare encrypted secrets.

## Cloud Run

Status badges: [credentials: Google Cloud project, location, and auth] [cost risk: jobs, services, logs, and networking] [capabilities: job native, service native] [cleanup: gcloud delete job/service or future lifecycle APIs]

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
import { Capsule } from "@capsule-sdk/core";
import { cloudRun } from "@capsule-sdk/cloud-run";

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

Cleanup: `capsule.service.delete(...)` deletes a Cloud Run service and reports `deleted` only when the delete operation completes without error. With `waitForOperations: false`, or when the operation is still running after `operationDeadlineMs`, it throws `PendingOperationError` carrying the operation name. Jobs remain in the project unless you delete them through Google Cloud tooling.

Options: `operationTimeoutMs` is the server-side wait sent with each `operations.wait` call; `operationDeadlineMs` (default `operationTimeoutMs`, else 300000) is the client budget across all waits; `operationPollIntervalMs` (default 1000); `requestTimeoutMs` (default 60000) bounds one HTTP request and its body; `maxResponseBytes` (default 32 MiB); `projectNumber` lets full resource names that use the numeric project number pass the scope check. Resource names outside the configured project and location are rejected before any request. Command healthchecks are rejected; path probes are supported.

Caveat: IAM, public access, networking, logging, and billing are Google Cloud concerns delegated to Cloud Run. Service rollback moves 100% of traffic to one revision; partial traffic splits are rejected until Capsule has an explicit split-release contract.

## Vercel

Status badges: [credentials: VERCEL_TOKEN] [cost risk: preview deployments, aliases, and runtime logs] [capabilities: edge native] [cleanup: Vercel deployment and alias removal]

Set:

```bash
export VERCEL_TOKEN=...
export VERCEL_TEAM_ID=... # optional
export VERCEL_PROJECT=... # optional
export CAPSULE_LIVE_TESTS=1
```

Inspect the declared capabilities:

```bash
pnpm --filter @capsule-sdk/cli exec node dist/index.js capabilities --adapter cloudflare
```

Credentials: `VERCEL_TOKEN`; optional team/project scoping through `VERCEL_TEAM_ID` and `VERCEL_PROJECT`.

Cleanup: remove preview deployments and aliases in Vercel. The example creates an inline preview deployment and does not auto-delete it.

Caveat: Capsule's first Vercel adapter uses inline deployment files. It supports bounded deployment event log reads and project runtime log reads when `projectId` is supplied; `follow` streaming is rejected. Runtime logs are a live tail read incrementally under `bounds` (records, bytes, deadline) with truncation reported; `since`/`until` are rejected for runtime logs and `limit` is enforced while reading. Client options `requestTimeoutMs` (default 60000) and `maxResponseBytes` (default 16 MiB) bound every request. Large file upload/SHA flow, env mutation, domains, routes, and rollback are explicit future capabilities.

## Kubernetes

Status badges: [credentials: kubeconfig or in-cluster config] [cost risk: cluster workloads and load balancers] [capabilities: job native, service native] [cleanup: kubectl delete resources]

Set:

```bash
export KUBECONFIG=/path/to/kubeconfig
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { kubernetes } from "@capsule-sdk/kubernetes";

const capsule = new Capsule({ adapter: kubernetes({ namespace: "default" }), receipts: true });
const job = await capsule.job.run({
  name: "capsule-job",
  image: "busybox:1.36",
  command: ["sh", "-c", "echo hello from kubernetes"]
});
console.log(job.status, job.receipt);
```

Credentials: Kubernetes client configuration, usually `KUBECONFIG`, in-cluster config, or default kubeconfig discovery.

Cleanup: `capsule.service.delete(...)` deletes the Deployment and the Service independently, treats a 404 as already absent, and reports `deleted` only after a read shows the objects are gone. If they are still terminating after `operationDeadlineMs` (default 120000, polled every `operationPollIntervalMs`, default 1000) it throws `PendingOperationError`. Delete Jobs and Pods with Kubernetes tooling. `job.run` returns status `running` with no result until a terminal status is read.

Options: by default the kubeconfig is parsed once per adapter and clients are reused; set `reloadKubeconfigPerOperation: true` if the kubeconfig or its current context can change during the adapter's life. Pod log reads are bounded per source and in aggregate, with at most `bounds.concurrency` reads in flight. Command healthchecks and an autoscaling `scale.max` that differs from the replica count are rejected.

Caveat: cluster admission policies, network policies, namespaces, service accounts, and node isolation determine the real security boundary.

## Lambda

Status badges: [credentials: AWS default credential chain] [cost risk: invocation, logs, and function side effects] [capabilities: job.run native invocation] [cleanup: no function created by Capsule]

Set AWS credentials through the default AWS credential chain:

```bash
export AWS_PROFILE=...
# or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN
export AWS_REGION=us-east-1
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { lambda } from "@capsule-sdk/lambda";

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

Caveat: Capsule models existing Lambda invocation as `job.run`; function deployment, IAM mutation, and event-source configuration are not implemented. The `DryRun` invocation type is rejected before any request, because a validation-only response is not an executed run. Receipts include invoke request ids, requested qualifier, executed version, and log-tail request id when AWS returns those fields.

## ECS/Fargate

Status badges: [credentials: AWS credentials, cluster, networking, task definition] [cost risk: Fargate tasks and services] [capabilities: job native, service native] [cleanup: stop tasks and delete services]

Set AWS credentials through the default AWS credential chain:

```bash
export AWS_PROFILE=...
export AWS_REGION=us-east-1
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { ecs } from "@capsule-sdk/ecs";

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

Cleanup: stopped one-shot tasks eventually disappear from active listings; services created by `service.deploy` can be deleted with `capsule.service.delete(...)` or ECS tooling. A non-forced delete scales the service to zero and waits for running and pending tasks to drain before `DeleteService`; `service.delete` then reports `deleted` only once `DescribeServices` shows `INACTIVE` (or the service is missing). Both waits share the `deleteObservation` budget (`deadlineMs` default 600000, `intervalMs` default 5000); when it expires the call throws `PendingOperationError` and writes no receipt. If `CreateService` succeeds and a later adapter step fails, Capsule deletes the created Service and reports the cleanup status (`pending` while `DRAINING`) on the thrown error.

Results and idempotency: a stopped task's result follows the configured main container (`containerName`): exit code 0 succeeds, any other code or a missing main container fails; every container's status is kept in metadata next to the raw `stopCode` and `stoppedReason`. An `idempotencyKey` on `job.run` is sent as a scoped native `clientToken`, which deduplicates retries with the same parameters inside the AWS token window; it is not exactly-once. `service.deploy` only tags the key.

Caveat: task definition registration, load balancers, IAM roles, logs, and service discovery are provider-specific and not faked.

## EC2

Status badges: [credentials: AWS credentials, region, AMI] [cost risk: instance runtime and EBS storage] [capabilities: machine native] [cleanup: capsule.machine.destroy or EC2 terminate]

Set AWS credentials through the default AWS credential chain:

```bash
export AWS_PROFILE=...
export AWS_REGION=us-east-1
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { ec2 } from "@capsule-sdk/ec2";

const capsule = new Capsule({ adapter: ec2({ region: process.env.AWS_REGION }), receipts: true });
const machine = await capsule.machine.create({
  name: "capsule-machine",
  image: "ami-...",
  size: "t3.micro"
});
console.log(machine.status, machine.receipt);
```

Credentials: AWS default credential chain and region; `image` must be a valid AMI for that region.

Behavior: `machine.status` reports `creating`, `running`, `stopping`, `stopped`, `destroying` or `deleted` from the native state and throws on an unrecognized state. `spec.region` must equal the adapter region; a conflict is rejected before any request. `spec.env` values become shell-literal exports in the user-data script; they do not persist into later processes on the machine. An `idempotencyKey` is sent as a scoped native `ClientToken`, which deduplicates retries with the same parameters inside the AWS token window; it is not exactly-once.

Cleanup: terminate machines with `capsule.machine.destroy(...)` or EC2 tooling. Stopping is not the same as deleting and may still incur storage cost. `force: true` forwards EC2 forced termination semantics; `providerOptions.skipOsShutdown` bypasses OS shutdown and should be used only when that data-integrity risk is acceptable.

Caveat: machines are the leakiest Capsule primitive. Networking, security groups, AMIs, instance profiles, SSH/SSM access, EBS volumes, and cost controls should remain visible to the caller.

## Fly Machines

Status badges: [credentials: FLY_API_TOKEN and FLY_APP_NAME] [cost risk: machines, regions, and networking] [capabilities: job native, machine native] [cleanup: auto-destroy job machines or machine.destroy]

Set:

```bash
export FLY_API_TOKEN=...
export FLY_APP_NAME=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { fly } from "@capsule-sdk/fly";

const capsule = new Capsule({ adapter: fly({ appName: process.env.FLY_APP_NAME }), receipts: true });
const run = await capsule.job.run({
  name: "capsule-fly-job",
  image: "flyio/hellofly:latest",
  command: "echo hello from fly"
});
console.log(run.status, run.receipt);
```

Credentials: `FLY_API_TOKEN` and `FLY_APP_NAME`; optional adapter settings include region, default image, CPU, memory, API base URL, `requestTimeoutMs` (default 60000) and `maxResponseBytes` (default 16 MiB).

Behavior: `machine.status` maps every documented Machine state, including transitions such as `starting`, `stopping` and `destroying`, and throws on an unrecognized state. `start` and `stop` report `starting` and `stopping` from the acknowledgement.

Cleanup: `job.run` creates an auto-destroy Fly Machine. Machines created through `machine.create` must be destroyed with `capsule.machine.destroy(...)` or Fly tooling.

Caveat: Fly app, region, networking, volume, autostart/autostop, and process semantics remain provider-specific.

## Azure Container Apps

Status badges: [credentials: AZURE_ACCESS_TOKEN, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP] [cost risk: Container Apps jobs, services, and environment resources] [capabilities: job native, service native] [cleanup: generated job cleanup or Azure delete]

Set:

```bash
export AZURE_ACCESS_TOKEN=...
export AZURE_SUBSCRIPTION_ID=...
export AZURE_RESOURCE_GROUP=...
export AZURE_LOCATION=eastus
export AZURE_CONTAINER_APP_ENVIRONMENT_ID=...
export CAPSULE_LIVE_TESTS=1
```

Use the adapter directly:

```ts
import { Capsule } from "@capsule-sdk/core";
import { azureContainerApps } from "@capsule-sdk/azure";

const capsule = new Capsule({
  adapter: azureContainerApps({
    location: process.env.AZURE_LOCATION,
    environmentId: process.env.AZURE_CONTAINER_APP_ENVIRONMENT_ID
  }),
  receipts: true
});

const job = await capsule.job.run({
  name: "capsule-azure-job",
  image: "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
});
console.log(job.status, job.receipt);
```

Credentials: Azure management access token, subscription id, resource group, location, and Container Apps environment id.

Cleanup: generated one-shot jobs are cleaned up on start failure; if that cleanup is still pending or fails, the error is a `PartialEffectsError` or `CleanupFailureError` naming the job. `job.cancel` stops a running execution only; it does not delete the Container Apps Job resource. `service.delete` treats ARM 202 as pending: it polls the same-origin operation URL (or the resource until 404) and reports `deleted` only on completion, otherwise `PendingOperationError` after `operationDeadlineMs` (default 300000). Successful jobs and services should be deleted through Azure tooling or supported Capsule lifecycle calls.

Options: `requestTimeoutMs` (default 60000), `maxResponseBytes` (default 32 MiB), `operationDeadlineMs` and `operationPollIntervalMs` (provider Retry-After, else 2000). Resource ids outside the configured subscription and resource group are rejected before any request. Healthchecks are rejected (`service.healthcheck` is unsupported).

Caveat: registries, secrets, logs, service rollback, ingress, workload profiles, and Azure identity boundaries are provider-specific and should be modeled explicitly.
