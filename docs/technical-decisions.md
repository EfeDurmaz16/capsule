# Technical Decisions

This document records the Capsule stack and the competitive research behind its shape. The contract-level decisions (plain TypeScript core, database-free/serverless core, adapter-first boundaries, observational receipts) live in [ADRs](adr/README.md); this file does not repeat them.

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

Capsule core stays a small SDK/spec/control-plane interface. It does not ship a web app, hosted backend, auth system, billing system, dashboard, or database dependency in the core package. Persistence is added as optional layers (`@capsule-sdk/store-sqlite`, a future `@capsule-sdk/store-postgres`, a future `@capsule-sdk/server`), and HTTP lives inside provider adapters rather than in core. See [ADR 0001](adr/0001-plain-typescript-core.md) and [ADR 0002](adr/0002-serverless-database-free-core.md).

## Research: files-sdk

Repository: `haydenbleasel/files-sdk`.

Observed design:

- Monorepo with a single main `files-sdk` package and many adapter subpaths.
- Public API is small: `Files({ adapter })`, common file operations, and a `files.raw` escape hatch.
- ESM package with `tsup`, tree-shakeable subpath exports such as `files-sdk/s3`, `files-sdk/r2`, `files-sdk/gcs`.
- Uses official provider SDK dependencies when useful, and Web-standard I/O types where possible.
- Shared internal helpers for body normalization, URL strategy, expiry defaults, and provider error mapping.
- Documents unsupported provider features loudly instead of pretending all storage providers are the same.
- AI tool integrations are subpaths with optional peer dependencies.

Implications for Capsule:

- Keep the core API small and boring, keep provider-specific escape hatches, and make unsupported features explicit and loud.
- Share adapter-author helpers in core, but avoid forcing every provider dependency into the main package.
- Use optional integration packages for AI framework wrappers.

Difference from Capsule: storage is one domain; Capsule spans sandboxes, jobs, services, edge runtimes, databases, previews, and machines, so it needs domain-aware capability maps instead of a single flat adapter interface.

## Research: ComputeSDK

Repository: `computesdk/computesdk`.

Observed design:

- pnpm monorepo with many provider packages; the main package focuses on sandbox execution.
- Providers are installed separately (E2B, Modal, Daytona, Vercel, CodeSandbox, Docker, Cloudflare, and others).
- `compute.setConfig({ provider })` supports multi-provider config with priority or round-robin routing.
- A provider factory package generates provider/sandbox wrappers from method definitions; Docker uses `dockerode`, not Docker CLI.
- The README says gateway/control-plane transport was removed from `computesdk`; users configure direct provider instances or use provider packages directly.

Implications for Capsule:

- A direct provider-instance model is validated by a nearby OSS project; avoid bundling hosted control-plane state into the core SDK.
- Multi-provider routing can be useful later, but Capsule should not auto-route across unlike domains without explicit capability and policy checks.
- A provider factory can reduce boilerplate, but Capsule needs a richer adapter contract because it is not sandbox-only.
- Docker CLI is acceptable for Capsule v1, though ComputeSDK's SDK-based Docker adapter shows the tradeoff between cleaner lifecycle operations and dependency weight.

Difference from Capsule: ComputeSDK is sandbox-first and normalizes a single sandbox shape; Capsule is domain-aware, preserves support levels, and centers receipts and policy decisions as first-class evidence.
