# Technical Decisions

This document records the early Capsule stack and architecture decisions.

## Current Stack

- TypeScript with strict mode.
- ESM packages.
- pnpm workspaces.
- `tsup` for package builds.
- `tsc -b` for type checking.
- Vitest for tests.
- Node.js standard library where practical.
- Docker adapter through Docker CLI, not Docker SDK, for the first real adapter.
- Provider API adapters may use native `fetch`, small signed-request helpers, or official SDKs when those SDKs provide real value.

Capsule core should stay a small SDK/spec/control-plane interface. It should not ship a web app, hosted backend, auth system, billing system, dashboard, or database dependency in the core package.

## Why Core Has No Database

Capsule receipts are JSON-serializable evidence records. The caller can store them in a database, object store, CI artifact, local file, or future Capsule server.

Persistence should be added as optional layers, not as a hard dependency:

- `@capsule/core`: types, policy, capabilities, receipts, adapter contracts.
- `@capsule/cli`: can write local JSONL receipt files.
- `@capsule/store-sqlite`: optional local persistence.
- `@capsule/store-postgres`: optional hosted persistence.
- `@capsule/server`: future hosted/control-plane layer.

This keeps library adoption simple while leaving room for deployment history, audit trails, and multi-user control planes later.

## Why Core Has No HTTP Framework

HTTP is required for real provider adapters such as Vercel, Cloudflare, Neon, AWS, GCP, E2B, Daytona, and Modal. That logic belongs inside the adapter package.

Core should not own a server or framework. Provider adapters can choose:

- native `fetch` for straightforward REST APIs;
- official SDKs when they provide auth, signing, pagination, retries, webhooks, or complex protocol correctness;
- small local helpers when only one or two endpoints are needed.

## Effect Decision

The public Capsule API should remain plain TypeScript and Promise-based.

Effect could help internally with typed errors, resource lifecycles, retries, timeouts, dependency injection, cancellation, structured logging, and concurrency. The cost is a higher adapter-author learning curve and a more opinionated public API.

Decision:

- Do not require Effect in `@capsule/core`.
- Keep `await capsule.sandbox.create(...)` and `await capsule.job.run(...)`.
- Consider a future optional `@capsule/effect` package that wraps the same core contracts for teams that want Effect.

## Research: files-sdk

Repository: `haydenbleasel/files-sdk`.

Observed design:

- Monorepo with a single main `files-sdk` package and many adapter subpaths.
- Public API is small: `Files({ adapter })`, common file operations, and `files.raw` escape hatch.
- ESM package with `tsup`.
- Tree-shakeable subpath exports such as `files-sdk/s3`, `files-sdk/r2`, `files-sdk/gcs`, `files-sdk/azure`, and AI tool subpaths.
- Uses Web-standard I/O types where possible.
- Uses official provider SDK dependencies when useful: AWS S3, Azure Blob, Google Cloud Storage, Google Drive, Microsoft Graph, Netlify Blobs, Supabase Storage, Vercel Blob, Box, Dropbox, UploadThing.
- Has shared internal helpers for body normalization, URL strategy, expiry defaults, and provider error mapping.
- Exposes provider escape hatches through `raw`.
- Documents unsupported provider features loudly instead of pretending all storage providers support the same operations.
- AI tool integrations are subpaths with optional peer dependencies.

Implications for Capsule:

- Keep the core API small and boring.
- Keep provider-specific escape hatches.
- Make unsupported features explicit and loud.
- Share adapter-author helpers in core, but avoid forcing every provider dependency into the main package.
- Use optional integration packages for AI framework wrappers.

Difference from Capsule:

- Storage is one domain; Capsule spans sandboxes, jobs, services, edge runtimes, databases, previews, and machines. Capsule therefore needs domain-aware capability maps instead of a single flat adapter interface.

## Research: ComputeSDK

Repository: `computesdk/computesdk`.

Observed design:

- pnpm monorepo with many provider packages.
- Main package focuses on sandbox execution.
- Providers are installed separately, e.g. E2B, Modal, Daytona, Vercel, CodeSandbox, Docker, Cloudflare, and others.
- `computesdk` exposes `compute.setConfig({ provider })` and multi-provider config with priority or round-robin routing.
- Provider factory package generates provider/sandbox wrappers from method definitions.
- Docker provider uses `dockerode`, not Docker CLI.
- Current README says gateway/control-plane transport has been removed from `computesdk`; users configure direct provider instances or use provider packages directly.
- Provider packages own API credentials and provider-specific behavior.
- Some CLI/auth/gateway pieces exist elsewhere in the repo, but the core SDK moved away from bundling gateway control-plane transport.

Implications for Capsule:

- A direct provider-instance model is validated by a nearby OSS project.
- Avoid bundling hosted control-plane state into the core SDK.
- Multi-provider routing can be useful later, but Capsule should not auto-route across unlike domains without explicit capability and policy checks.
- A provider factory can reduce boilerplate, but Capsule needs a richer adapter contract because it is not sandbox-only.
- Docker CLI is still acceptable for Capsule v1 because the prompt explicitly wants no Docker SDK, but ComputeSDK's Docker adapter shows the tradeoff: SDKs can make lifecycle operations cleaner at the cost of dependency weight.

Difference from Capsule:

- ComputeSDK is sandbox-first. Capsule is domain-aware across execution, deployment, database resources, previews, and machines.
- ComputeSDK normalizes a sandbox shape. Capsule must preserve support levels and avoid pretending deployment providers are interchangeable.
- Capsule receipts and policy decisions are first-class; ComputeSDK does not center an evidence model in the same way.

## Resulting Capsule Direction

Capsule should be:

- SDK-first.
- Adapter-first.
- Domain-aware.
- Capability-explicit.
- Receipt-oriented.
- Policy-aware.
- Minimal in core dependencies.
- Honest about unsupported and emulated behavior.

Capsule should not start as:

- a hosted deployment platform;
- a database-backed control plane;
- a SaaS dashboard;
- a Terraform/Pulumi replacement;
- a universal sandbox abstraction;
- an Effect-only library.

Future layers can add persistence, hosted APIs, richer orchestration, queues, dashboarding, and Effect wrappers without changing the core contract.
