# Capsule

Capsule is a domain-aware adapter layer for agent execution and cloud runtimes.

It does not pretend every provider is the same.

Instead, it defines small contracts for adjacent runtime domains: sandboxes, jobs, services, edge runtimes, database resources, machines, and preview environments.

Capsule makes runtime capabilities, policies, logs, artifacts, and execution receipts explicit.

## What It Is

Capsule is a TypeScript-first OSS control-plane interface for running code, jobs, services, edge functions, database branches, and preview environments across provider adapters. It is inspired by files-sdk's clean adapter model, but the runtime domain is leakier and more security-sensitive, so Capsule exposes support levels instead of hiding differences.

## What It Is Not

Capsule is not a fake universal cloud abstraction, PaaS clone, Terraform or Pulumi replacement, Nitric or Encore replacement, Docker wrapper only, sandbox provider, deployment provider, or security magic layer.

## Install

```bash
pnpm add @capsule/core @capsule/adapter-docker
```

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

| Provider | Sandbox | Job | Service | Edge | Database | Preview | Machine |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Docker | native | native | unsupported | unsupported | unsupported | unsupported | unsupported |
| E2B | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported |
| Cloud Run | unsupported | native | native | unsupported | unsupported | experimental | unsupported |
| Cloudflare Workers | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported |
| Vercel | unsupported | unsupported | experimental | native | unsupported | experimental | unsupported |
| Daytona | native | emulated | unsupported | unsupported | unsupported | experimental | unsupported |
| Modal | native | native | experimental | unsupported | unsupported | experimental | unsupported |
| Cloud Run | unsupported | native | native | unsupported | unsupported | experimental | unsupported |
| Vercel | unsupported | unsupported | experimental | native | unsupported | experimental | unsupported |
| Cloudflare | experimental | experimental | experimental | native | experimental | experimental | unsupported |
| Neon | unsupported | unsupported | unsupported | unsupported | native | experimental | unsupported |
| Lambda | unsupported | native | unsupported | experimental | unsupported | unsupported | unsupported |
| ECS/Fargate | unsupported | native | native | unsupported | unsupported | experimental | unsupported |
| Kubernetes | experimental | native | native | unsupported | experimental | experimental | experimental |
| EC2 | unsupported | emulated | emulated | unsupported | unsupported | unsupported | native |

## Docs

- [Manifesto](docs/manifesto.md)
- [Architecture](docs/architecture.md)
- [Primitive taxonomy](docs/primitive-taxonomy.md)
- [Adapter contract](docs/adapter-contract.md)
- [Capability model](docs/capability-model.md)
- [Policy model](docs/policy-model.md)
- [Execution receipts](docs/execution-receipts.md)
- [Provider matrix](docs/provider-matrix.md)
- [Security model](docs/security-model.md)
- [Roadmap](docs/roadmap.md)
- [Real provider gap register](docs/real-provider-gap-register.md)
- [Contributing](docs/contributing.md)
- [Comparison](docs/comparison.md)
- [Technical decisions](docs/technical-decisions.md)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Packages

- `@capsule/core`: domain types, `Capsule` facade, capabilities, policy, receipts, errors, logs, artifacts, and adapter contracts.
- `@capsule/adapter-docker`: real Docker CLI adapter for sandbox and one-shot job execution.
- `@capsule/adapter-e2b`: real E2B SDK adapter for cloud sandbox execution.
- `@capsule/adapter-cloudflare`: real Cloudflare API adapter for Worker module edge deployment.
- `@capsule/adapter-cloud-run`: real Cloud Run Admin API adapter for jobs and services.
- `@capsule/adapter-neon`: real Neon API adapter for database branch create/delete and connection URI retrieval.
- `@capsule/adapter-vercel`: real Vercel REST adapter for inline deployment creation.
- `@capsule/adapter-mock`: mock E2B, Daytona, Modal, Cloud Run, Vercel, Cloudflare, Neon, Lambda, ECS, Kubernetes, and EC2 capability models.
- `@capsule/ai`: framework-agnostic code execution tool helper.
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

## Real And Mocked

Real in this repository:

- core TypeScript contracts;
- capability negotiation;
- policy checks for env/secrets and timeout merging;
- receipt generation with SHA-256 stdout/stderr hashes;
- Docker CLI sandbox/job adapter;
- E2B cloud sandbox create/exec/file/list/destroy through the E2B SDK;
- Cloudflare Worker module upload through the Cloudflare API;
- Cloud Run job run and service deploy through the Cloud Run Admin API;
- Neon database branch create/delete through the Neon API;
- Vercel inline deployment creation through the Vercel REST API;
- Neon connection URI retrieval when `databaseName` and `roleName` are configured;
- local JSONL receipt persistence through `@capsule/store-jsonl`;
- mock provider adapters;
- CLI;
- examples and tests.

Mocked:

- Daytona, Modal, Lambda, ECS, Kubernetes, and EC2 provider calls;
- service, edge, database, preview, and machine lifecycle operations outside Docker;
- preview orchestration across real providers.

CLI examples:

```bash
capsule capabilities --adapter neon
capsule neon branch-create --project "$NEON_PROJECT_ID" --name pr-42 --database neondb --role neondb_owner --receipt-file .capsule/receipts.jsonl
capsule neon branch-delete --project "$NEON_PROJECT_ID" --branch-id br_xxx --hard-delete --receipt-file .capsule/receipts.jsonl
```

Known limitations:

- Capsule is not a sandbox by itself.
- Docker local is not safe for hostile untrusted code by default.
- Policy enforcement depends on adapter/provider support.
- Receipts record what Capsule observed; they are not signed attestations yet.
- Hosted persistence, auth, dashboard, queues, and server APIs are intentionally outside core.

Capsule is designed for provider teams, framework maintainers, and runtime engineers to critique and extend. Adapter contributions should include capability maps, docs, and contract tests.
