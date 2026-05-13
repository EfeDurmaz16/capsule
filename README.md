# Capsule

[![CI](https://github.com/EfeDurmaz16/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/EfeDurmaz16/capsule/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![ESM](https://img.shields.io/badge/modules-ESM-111111.svg)
![pnpm](https://img.shields.io/badge/workspace-pnpm-f69220.svg)
![Package status](https://img.shields.io/badge/npm-not_published_yet-666666.svg)

Capsule is a domain-aware adapter layer for agent execution and cloud runtimes.

It does not pretend every provider is the same.

Instead, it defines small contracts for adjacent runtime domains: sandboxes, jobs, services, edge runtimes, database resources, machines, and preview environments.

Capsule makes runtime capabilities, policies, logs, artifacts, and execution receipts explicit.

## What It Is

Capsule is a TypeScript-first OSS control-plane interface for running code, jobs, services, edge functions, database branches, and preview environments across provider adapters. It is inspired by files-sdk's clean adapter model, but the runtime domain is leakier and more security-sensitive, so Capsule exposes support levels instead of hiding differences.

## What It Is Not

Capsule is not a fake universal cloud abstraction, PaaS clone, Terraform or Pulumi replacement, Nitric or Encore replacement, Docker wrapper only, sandbox provider, deployment provider, or security magic layer.

## Install

Package names are reserved in the repo contract but not published to npm yet. Until the first release, use the workspace packages from this repository. The install commands below show the intended npm package names after publication.

```bash
pnpm add @capsule/core @capsule/adapter-docker
```

Install only the adapters you use:

```bash
pnpm add @capsule/core @capsule/adapter-e2b
pnpm add @capsule/core @capsule/adapter-neon
pnpm add @capsule/core @capsule/adapter-vercel
pnpm add @capsule/core @capsule/adapter-mock
```

`@capsule/adapter-mock` is for tests, examples, and future-provider modeling. It does not call real provider APIs.

## Quickstart

```ts
import { Capsule } from "@capsule/core";
import { docker } from "@capsule/adapter-docker";

const capsule = new Capsule({
  adapter: docker(),
  policy: {
    network: { mode: "none" },
    limits: { timeoutMs: 60_000 }
  },
  receipts: true
});

const box = await capsule.sandbox.create({ image: "node:22" });

await box.writeFile("/workspace/index.js", "console.log('hello from capsule')");
const result = await box.exec({ command: ["node", "/workspace/index.js"] });

console.log(result.stdout);
console.log(result.receipt);

await box.destroy();
```

## Domain APIs

```ts
await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('job')"] });
await capsule.service.deploy({ name: "api", image: "example/api:latest" });
await capsule.edge.deploy({ name: "worker", runtime: "workers" });
await capsule.database.branch.create({ project: "app", name: "pr-42" });
await capsule.preview.create({ name: "pr-42" });
await capsule.machine.create({ name: "runner", image: "ubuntu-24.04" });
```

## Capabilities

```ts
capsule.supports("sandbox.exec");
capsule.supportLevel("service.deploy");
capsule.capabilities();
capsule.adapterName();
capsule.raw();
```

Support levels are `native`, `emulated`, `unsupported`, and `experimental`. Adapters must declare what they support; unsupported capabilities throw `UnsupportedCapabilityError`.

## Policy And Receipts

Capsule can apply network, filesystem, secrets, limits, cost, TTL, and approval policies before runtime actions. Receipts record the provider, adapter, capability path, support level, timing, output hashes, resource identifiers, and policy decision. Receipts prove what Capsule observed, not absolute truth.

## Provider Matrix

`native`, `experimental`, `emulated`, and `unsupported` are adapter-declared support levels. This short table covers real adapters in this repo; mock-only modeling is listed separately below.

| Provider | Package | Sandbox | Job | Service | Edge | Database | Preview | Machine |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker | `@capsule/adapter-docker` | native | native | unsupported | unsupported | unsupported | unsupported | unsupported |
| E2B | `@capsule/adapter-e2b` | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported |
| Daytona | `@capsule/adapter-daytona` | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported |
| Modal | `@capsule/adapter-modal` | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported |
| Cloud Run | `@capsule/adapter-cloud-run` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported |
| Cloudflare Workers | `@capsule/adapter-cloudflare` | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported |
| Vercel | `@capsule/adapter-vercel` | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported |
| Neon | `@capsule/adapter-neon` | unsupported | unsupported | unsupported | unsupported | native | unsupported | unsupported |
| Kubernetes | `@capsule/adapter-kubernetes` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported |
| Lambda | `@capsule/adapter-lambda` | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported |
| ECS/Fargate | `@capsule/adapter-ecs` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported |
| EC2 | `@capsule/adapter-ec2` | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | native |
| Fly Machines | `@capsule/adapter-fly` | unsupported | native | unsupported | unsupported | unsupported | unsupported | native |
| Azure Container Apps | `@capsule/adapter-azure-container-apps` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported |

Mock modeling package:

- `@capsule/adapter-mock`: mock E2B, Daytona, Modal, Cloud Run, Vercel, Cloudflare, Neon, Lambda, ECS, Kubernetes, and EC2 capability models for tests/examples. It returns fake objects and receipts and should not be presented as a real provider integration.

## Docs

- [Manifesto](docs/manifesto.md)
- [Architecture](docs/architecture.md)
- [Primitive taxonomy](docs/primitive-taxonomy.md)
- [Adapter contract](docs/adapter-contract.md)
- [Capability model](docs/capability-model.md)
- [Policy model](docs/policy-model.md)
- [Execution receipts](docs/execution-receipts.md)
- [Provider matrix](docs/provider-matrix.md)
- [Real provider quickstarts](docs/real-provider-quickstarts.md)
- [Live provider tests](docs/live-tests.md)
- [Publish readiness](docs/publish-readiness.md)
- [Unfinished marker gate](docs/unfinished-marker-gate.md)
- [V2 readiness audit](docs/v2-readiness-audit.md)
- [API reference](docs/api-reference.md) (`pnpm docs:api`)
- [Security model](docs/security-model.md)
- [Roadmap](docs/roadmap.md)
- [Real provider gap register](docs/real-provider-gap-register.md)
- [Symphony harness](docs/symphony-harness.md)
- [Autopilot runbook](docs/autopilot-runbook.md)
- [Contributing](docs/contributing.md)
- [Comparison](docs/comparison.md)
- [Technical decisions](docs/technical-decisions.md)
- [Architecture decision records](docs/adr/README.md)
- [V1 readiness audit](docs/v1-readiness-audit.md)
- [V2 plan](docs/v2-plan.md)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Project Status

Capsule is pre-1.0 OSS infrastructure. The core contracts, real provider adapters, CLI, examples, tests, docs, release audit, and automation harness are present in this repository. Packages are not published to npm yet, and live provider operations require explicit credentials plus provider-specific quickstart steps.

## Packages

- `@capsule/core`: domain types, `Capsule` facade, capabilities, policy, receipts, errors, logs, artifacts, and adapter contracts.
- `@capsule/adapter-docker`: real Docker CLI adapter for sandbox and one-shot job execution.
- `@capsule/adapter-e2b`: real E2B SDK adapter for cloud sandbox execution.
- `@capsule/adapter-daytona`: real Daytona SDK adapter for sandbox execution.
- `@capsule/adapter-modal`: real Modal JS SDK adapter for sandbox execution.
- `@capsule/adapter-cloudflare`: real Cloudflare API adapter for Worker module edge deployment.
- `@capsule/adapter-cloud-run`: real Cloud Run Admin API adapter for jobs and services.
- `@capsule/adapter-kubernetes`: real Kubernetes client adapter for Jobs, Deployments, Services, and selector-based combined Pod log reads.
- `@capsule/adapter-lambda`: real AWS Lambda invoke adapter for existing functions as jobs.
- `@capsule/adapter-ecs`: real ECS/Fargate adapter for existing task definitions.
- `@capsule/adapter-ec2`: real EC2 adapter for machine creation.
- `@capsule/adapter-fly`: real Fly Machines API adapter for machine lifecycle and one-shot job machines.
- `@capsule/adapter-azure-container-apps`: real Azure Container Apps ARM adapter for service deploys and manual jobs.
- `@capsule/adapter-neon`: real Neon API adapter for database branch create/delete/reset and connection URI retrieval.
- `@capsule/adapter-vercel`: real Vercel REST adapter for inline deployment creation, bounded deployment event logs, project runtime logs, and alias release.
- `@capsule/adapter-mock`: mock E2B, Daytona, Modal, Cloud Run, Vercel, Cloudflare, Neon, Lambda, ECS, Kubernetes, and EC2 capability models.
- `@capsule/ai`: framework-agnostic code execution tool helper.
- `@capsule/preview`: preview environment composition helpers for Capsule-backed services, edges, database branches, and jobs.
- `@capsule/cli`: small CLI with `doctor`, `capabilities`, `run`, and `sandbox`.

## Examples

```bash
pnpm --filter @capsule/example-capability-check start
pnpm --filter @capsule/example-policy-receipts start
pnpm --filter @capsule/example-deployment-model start
pnpm --filter @capsule/example-edge-model start
pnpm --filter @capsule/example-database-branch-model start
pnpm --filter @capsule/example-preview-environment-model start
pnpm --filter @capsule/example-machine-model start
```

Docker-backed examples require Docker:

```bash
pnpm --filter @capsule/example-sandbox-docker start
pnpm --filter @capsule/example-job-docker start
```

## Maintainer Autopilot

Capsule includes a repo-local automation harness for long-running maintenance work:

```bash
pnpm capsule:gap
pnpm capsule:issues
pnpm capsule:autopilot -- --once --dry-run --max-parallel 2
```

For an overnight run on macOS:

```bash
nohup caffeinate -dimsu node scripts/capsule-autopilot.mjs --max-parallel 2 > .symphony/logs/autopilot.log 2>&1 &
```

## Real And Mocked

Real in this repository:

- core TypeScript contracts;
- capability negotiation;
- policy checks for env/secrets and timeout merging;
- receipt generation with SHA-256 stdout/stderr hashes;
- Docker CLI sandbox/job adapter;
- E2B cloud sandbox create/exec/file/list/destroy through the E2B SDK;
- Daytona sandbox create/exec/file/list/destroy through the Daytona SDK;
- Modal sandbox create/exec/read/write/destroy through the Modal JS SDK;
- Cloudflare Worker module upload through the Cloudflare API;
- Cloud Run job run, service deploy, and bounded job/service log reads through the Cloud Run Admin API and Cloud Logging;
- Kubernetes Job, Deployment, Service creation, and selector-based combined Pod log reads through the official Kubernetes client;
- AWS Lambda invocation through AWS SDK v3;
- ECS RunTask and CreateService through AWS SDK v3;
- EC2 RunInstances through AWS SDK v3;
- Fly Machines create/start/status/stop/destroy and auto-destroy one-shot job machines through the Fly Machines API;
- Azure Container Apps service create/update and manual job create/start through ARM REST APIs;
- Neon database branch create/delete/reset through the Neon API;
- Vercel inline deployment creation, bounded deployment event logs, project runtime logs, and alias release through the Vercel REST API;
- Neon connection URI retrieval when `databaseName` and `roleName` are configured;
- local JSONL receipt persistence through `@capsule/store-jsonl`;
- mock provider adapters;
- CLI;
- examples and tests.

Mocked:

- no original provider family is represented only by mocks; remaining gaps are explicit unsupported or experimental capabilities inside real adapters.
- service, edge, database, preview, and machine lifecycle operations outside Docker;
- provider-native preview orchestration across real providers.

CLI examples:

```bash
capsule doctor
capsule doctor --adapter cloudflare
capsule capabilities --adapter neon
capsule service deploy --adapter cloud-run --project-id "$GOOGLE_CLOUD_PROJECT" --location us-central1 --name api --image us-docker.pkg.dev/project/repo/api:tag --port 8080
capsule service status --adapter cloud-run --project-id "$GOOGLE_CLOUD_PROJECT" --location us-central1 --id api
capsule service delete --adapter cloud-run --project-id "$GOOGLE_CLOUD_PROJECT" --location us-central1 --id api --reason cleanup
capsule job status --adapter cloud-run --project-id "$GOOGLE_CLOUD_PROJECT" --location us-central1 --id "projects/$GOOGLE_CLOUD_PROJECT/locations/us-central1/jobs/smoke/executions/smoke-abc"
capsule job cancel --adapter cloud-run --project-id "$GOOGLE_CLOUD_PROJECT" --location us-central1 --id "projects/$GOOGLE_CLOUD_PROJECT/locations/us-central1/jobs/smoke/executions/smoke-abc" --reason cleanup
capsule neon branch-create --project "$NEON_PROJECT_ID" --name pr-42 --database neondb --role neondb_owner --receipt-file .capsule/receipts.jsonl
capsule neon branch-delete --project "$NEON_PROJECT_ID" --branch-id br_xxx --hard-delete --receipt-file .capsule/receipts.jsonl
```

`capsule doctor` reports Docker daemon availability plus provider credential env-var status without printing secret values.

Known limitations:

- Capsule is not a sandbox by itself.
- Docker local is not safe for hostile untrusted code by default.
- Policy enforcement depends on adapter/provider support.
- Receipts record what Capsule observed; they are not signed attestations yet.
- Hosted persistence, auth, dashboard, queues, and server APIs are intentionally outside core.

Capsule is designed for provider teams, framework maintainers, and runtime engineers to critique and extend. Adapter contributions should include capability maps, docs, and contract tests.
