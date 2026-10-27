# Roadmap

## Foundation

Core types, capability negotiation, support levels, errors, policy decisions, receipt generation, logs, artifacts, and contract tests.

## Sandbox Adapters

Docker, E2B, Daytona, Modal Sandboxes, Cloudflare Sandbox, Microsandbox, and future Firecracker or microVM adapters.

Current real adapters (the generated [provider matrix](provider-matrix.md) is the source of truth for per-capability support levels):

- Docker sandbox/job.
- E2B, Daytona, and Modal sandbox execution.
- Neon database/resource.
- Cloud Run jobs/services.
- Kubernetes jobs/services.
- AWS Lambda invocation of an existing function as a job, ECS/Fargate jobs/services, and EC2 machines.
- Fly Machines jobs and machine lifecycle. Fly services are a future target, not current support.
- Azure Container Apps jobs/services.
- Vercel edge/deployment runtime operations.
- Cloudflare Workers edge deployment, version, route, and rollback operations.

Next real adapters:

- Additional database/resource adapters such as Supabase branching, PlanetScale-style branching, and Cloudflare D1/KV/R2.
- Additional edge/runtime adapters such as Cloudflare Containers, Netlify-style functions, and provider-specific routing/binding APIs.
- Additional low-level machine adapters such as Compute Engine, Azure VM, bare metal, Firecracker, Nomad, and microVM providers.

## Job And Service Adapters

Cloud Run, ECS/Fargate, Kubernetes, Azure Container Apps, Modal, Docker, Fly Machines, and other container platforms.

## Edge And Deploy Adapters

Vercel, Cloudflare Workers/Pages/Containers, Lambda, Netlify-style functions, and routing or binding models.

## Database And Resource Adapters

Neon, Cloudflare D1/KV/R2, Supabase branching, PlanetScale-style branching, and managed resource receipts.

Neon branch create/delete/reset and connection URI retrieval are implemented. Migrations, snapshots, and broader restore workflows remain planned.

## Preview Orchestration

Compose services, edge deployments, database branches, jobs, checks, logs, artifacts, and preview receipts.

Implemented today: sequential creation, reverse-order cleanup of services and database branches, `PreviewCreationError` with the resources created before a failure, and graph-local cleanup plans. Edge and job resources have no cleanup action. Preview TTL is recorded only (`ttl.enforcement: "record-only"`); a TTL cleanup controller, durable resource tracking and parallel provisioning are future work.

## Machine Adapters

EC2, Compute Engine, Azure VM, bare metal, Firecracker, Nomad, and low-level Fly Machines.

## Contract Tests

Reusable adapter tests for capability declarations, domain behavior, policy propagation, receipts, and unsupported paths.

The current `runAdapterContract` runner is guard-only: it checks declarations and that unsupported paths fail closed, and it passes even when lifecycle calls such as destroy always throw. Lifecycle and domain behavior checks are future work.

## Signed Receipts

Optional caller-configured receipt signatures with key metadata and signature verification exist today. FIDES-style attestations, provider attestation, the evidence-grade profile and tamper-evident evidence logs remain future work.

## Framework Integrations

Vercel AI SDK, OpenAI Agents, LangChain, Claude tools, Mastra, CrewAI, CI systems, preview environments, and deployment platforms.

## Official Provider Adapters

Provider-maintained adapters with explicit capability maps, changelog tracking, and compatibility tests.

## Known Gaps Carried Forward

These items were found in the M1 correctness audit and deliberately left open. Each has a visible skipped test named after its id, so the gap stays in the test output until it is fixed.

| Id      | Current behavior                                                  | What it waits for                                                                                                                                                              |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PERF-14 | Docker sandbox artifact collection runs one `docker cp` per path. | A spawn-count, bytes and time profile for 1, 10 and 100 paths; any batch must keep the current artifact layout. Skipped test: `packages/docker/src/audit-regressions.test.ts`. |

Other limits that stay visible:

- Sandbox file operations have no per-call approval override yet; fresh approval covers exec and destroy (see [policy model](policy-model.md)).
- Preview resources and cleanup plans live in process memory; a crash before cleanup loses them.
- Each `Capsule` instance adds an `AsyncLocalStorage` scope per operation; very large numbers of concurrent operations on one instance have not been profiled.

## Verification Levels

Tests in this repository fall into separate evidence classes, and a pass in one never stands in for another:

- **Mock and fake-client tests** (`pnpm test`): adapters run against injected fake clients, recorded response shapes and the installed SDK exception classes. They prove request mapping, error handling and fail-closed behavior, not provider behavior.
- **Emulated capabilities**: the `emulated` support level means Capsule implements a capability itself on top of the provider (for example Docker sandbox artifacts via `docker cp`). It is not an emulator test. No provider emulator is used in CI.
- **Local real-process tests**: Docker CLI tests use a fake `docker` executable; the Docker end-to-end example needs a local daemon and is not run in CI.
- **Live tests**: gated, manually dispatched, and counted only when at least one live test executed and passed (see [live tests](live-tests.md)). No live test has been recorded as executed for the M1 changes, so no adapter is live-verified by them.
- **Benchmarks**: synthetic workloads with fake clients; resource counts are gated, timings are host-specific and never a cloud latency claim.
