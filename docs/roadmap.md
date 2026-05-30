# Roadmap

## Foundation

Core types, capability negotiation, support levels, errors, policy decisions, receipt generation, logs, artifacts, and contract tests.

## Sandbox Adapters

Docker, E2B, Daytona, Modal Sandboxes, Cloudflare Sandbox, Microsandbox, and future Firecracker or microVM adapters.

Current real adapters:

- Docker sandbox/job.
- E2B, Daytona, and Modal sandbox execution.
- Neon database/resource.
- Cloud Run jobs/services.
- Kubernetes jobs/services.
- AWS Lambda functions, ECS/Fargate jobs/services, and EC2 machines.
- Fly Machines jobs/services/machine lifecycle.
- Azure Container Apps jobs/services.
- Vercel edge/deployment runtime operations.
- Cloudflare Workers edge deployment, version, and rollback operations.

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

Compose services, edge deployments, database branches, jobs, checks, TTL cleanup, logs, artifacts, and preview receipts.

## Machine Adapters

EC2, Compute Engine, Azure VM, bare metal, Firecracker, Nomad, and low-level Fly Machines.

## Contract Tests

Reusable adapter tests for capability declarations, domain behavior, policy propagation, receipts, and unsupported paths.

## Signed Receipts

Optional signatures, key IDs, FIDES-style attestations, and tamper-evident evidence logs.

## Framework Integrations

Vercel AI SDK, OpenAI Agents, LangChain, Claude tools, Mastra, CrewAI, CI systems, preview environments, and deployment platforms.

## Official Provider Adapters

Provider-maintained adapters with explicit capability maps, changelog tracking, and compatibility tests.
