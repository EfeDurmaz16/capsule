# Capsule Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for parallel execution, or superpowers:executing-plans for inline execution. Each issue below is sized for one focused PR unless its acceptance criteria explicitly require a broader migration.

**Goal:** Turn Capsule into a release-ready OSS project and a credible foundation for a paid control-plane product.

**Architecture:** Keep the public OSS core honest: typed TypeScript contracts, provider-specific adapters, fail-closed policy checks, durable receipts, live-provider verification, and public docs that match real behavior. Commercial work should sit above the OSS package boundary as project/org control-plane, policy bundle, evidence dashboard, and managed-credential surfaces.

**Tech Stack:** TypeScript, ESM, pnpm workspaces, Vitest, Changesets, GitHub Actions, provider REST APIs, and small local scripts.

---

## Execution Rules

- One issue should close with tests, docs when relevant, and one atomic commit.
- Parallelize by lane. Do not assign two write agents to the same package or script at the same time.
- Every PR must end with `pnpm typecheck`, the focused tests for the changed area, and one stronger repo-level verification command when practical.
- Security-sensitive changes must preserve deny-by-default behavior, avoid secret logging, and prove policy evaluation happens before provider execution.
- Provider lifecycle changes must prove cleanup for partial success and must not hide provider failures that affect billable resources.
- Public docs must be written in English and must not overclaim provider parity, release readiness, or evidence guarantees.

## Parallel Agent Lanes

| Lane | Owns | Can run in parallel with |
| --- | --- | --- |
| Release | `package.json`, `.github/`, `.changeset/`, `scripts/package-*` | Docs, CLI, provider adapters |
| Core security | `packages/core/src/*`, receipt stores, policy model | Docs, single non-core adapter work after interface review |
| Provider lifecycle | One adapter package at a time | Other adapters if files do not overlap |
| Live verification | `docs/live-tests.md`, live test files, provider env checks | Docs, release scripts |
| CLI and DX | `packages/cli`, examples, developer scripts | Docs, provider adapters |
| OSS docs | `README.md`, `docs/*`, examples | Most code lanes after behavior is known |
| Product surface | commercial architecture docs and demos | OSS docs, CLI |
| Operations | telemetry, support bundles, runbooks | CLI, docs |

## Definition Of Done

- The issue has an explicit test or verification command below.
- `git diff --check` passes.
- Relevant generated docs, especially `docs/api-reference.md`, are refreshed when public APIs change.
- No `dist` artifacts, live-test outputs, credentials, provider resource ids, or operator notes are committed.
- The commit message names the domain, for example `fix(core): bind receipts to operation context`.

## Issue Backlog

### Release, Packaging, And CI

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P001 | done | High | Harden workspace verification gates | Build artifacts are cleaned before builds, test files are pruned from publishable `dist`, private packages are ignored by Changesets, and pack smoke uses packed tarballs. | `pnpm typecheck && pnpm test && pnpm build && pnpm release:audit` |
| CAP-P002 | done | High | Publish packages from the Changesets workflow | Release workflow publishes through `pnpm release`, uses npm token and provenance config, and keeps CI verification before publish. | `pnpm release:audit` plus workflow review |
| CAP-P003 | open | High | Add post-publish provenance verification | Add a script that verifies published package provenance metadata for every public package after a release. | `pnpm release:audit && node scripts/verify-published-provenance.mjs --dry-run` |
| CAP-P004 | open | Medium | Add package tarball size budgets | Add per-package packed size budgets and fail release audit when a package grows unexpectedly. | `pnpm release:pack-smoke` |
| CAP-P005 | open | High | Add public API drift gate | Add a generated API snapshot or extractor-style check so changed exports require intentional review. | `pnpm docs:api && git diff --exit-code docs/api-reference.md` |
| CAP-P006 | open | Medium | Add npm metadata dry-run audit | Verify package names, descriptions, repository links, keywords, license, files, bin targets, and publish access before publish. | `pnpm release:metadata-audit` |
| CAP-P007 | open | Medium | Add release notes template by domain | Add a release notes template that groups core, adapter, docs, and breaking changes. | `git diff --check && pnpm release:markers` |
| CAP-P008 | open | High | Verify package exports on Node 20 and 22 | Add CI matrix coverage that imports every public package on supported Node versions. | `pnpm test packages/core/src/package-exports.test.ts` plus CI matrix |
| CAP-P009 | open | High | Add dependency and license audit | Add a lightweight script that reports non-MIT-compatible licenses and unexpected new runtime dependencies. | `pnpm release:audit` |
| CAP-P010 | open | Medium | Add release rollback runbook | Document how to yank, deprecate, or hotfix a bad package release without rewriting history. | `git diff --check` |

### Public Surface And Documentation Truth

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P011 | done | High | Refresh public project surface | README and docs describe Capsule as an OSS runtime control-plane interface without private project phrasing or overclaiming. | `git diff --check` |
| CAP-P012 | open | High | Add README first-release checklist | README states package status, install path before npm publication, minimal quickstart, and release readiness without ambiguity. | `git diff --check && pnpm release:markers` |
| CAP-P013 | open | Medium | Generate provider matrix from adapters | Provider matrix docs are generated from adapter capability declarations instead of duplicated manual tables. | `pnpm capsule:gap && git diff --check` |
| CAP-P014 | open | Medium | Add architecture diagram source | Add Mermaid or text diagrams for Capsule, adapters, policy, receipts, stores, and live tests. | `git diff --check` |
| CAP-P015 | open | High | Align security model with current enforcement | `docs/security-model.md` states what is enforced, what is best-effort, and what is not evidence-grade yet. | `git diff --check && pnpm test packages/core/src/core.test.ts` |
| CAP-P016 | open | High | Align execution receipts docs with store behavior | Receipt docs distinguish in-memory capture, JSONL, SQLite, signing, and required durability modes. | `git diff --check && pnpm test packages/core/src/core.test.ts` |
| CAP-P017 | open | Medium | Add provider quickstart status badges | Each real-provider quickstart states credential requirements, cost risk, supported capabilities, and cleanup command. | `git diff --check` |
| CAP-P018 | open | Medium | Add comparison decision table | Comparison doc explains when to use Capsule, provider SDKs, Terraform, Pulumi, Nitric, Encore, or a managed PaaS. | `git diff --check` |
| CAP-P019 | open | Medium | Add ADR for evidence-grade receipts | Record the difference between observational receipts and evidence-grade receipts, including failure modes. | `git diff --check` |
| CAP-P020 | open | Low | Add issue-label taxonomy | Document labels for core, adapter, docs, release, security, live-test, good-first-issue, and commercial-surface work. | `git diff --check` |

### Core Policy And Evidence

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P021 | done | High | Fail closed on approval and TTL policies | `approvals.required` denies by default, TTL policy evaluates `ttlMs`, and mutating operations check policy before execution. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P022 | done | High | Accept explicit approval grants | Mutating operation specs accept typed approval grants and successful policy checks record approval id and reason. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P023 | done | High | Remove raw receipt recording escape hatch | Adapter context no longer exposes a generic raw receipt recorder that can bypass normal receipt shaping. | `pnpm typecheck && pnpm test packages/core/src/core.test.ts` |
| CAP-P024 | done | High | Propagate approval grants into adapter context | Adapters that call `context.evaluatePolicy()` receive the operation approval defaults and do not reject approved operations. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P025 | open | High | Bind receipts to the current operation | `createReceipt` rejects mismatched capability paths and operation types for the active adapter operation. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P026 | open | High | Add required receipt durability mode | A required receipt store mode preflights writable storage and fails before side effects when durability is not available. | `pnpm test packages/core/src/core.test.ts packages/store-jsonl/src/*.test.ts packages/store-sqlite/src/*.test.ts` |
| CAP-P027 | open | High | Add receipt store durability contract | JSONL and SQLite stores document and test write, flush, close, corruption, and concurrent-write behavior. | `pnpm test packages/store-jsonl/src/*.test.ts packages/store-sqlite/src/*.test.ts` |
| CAP-P028 | open | High | Enforce policy for sandbox sub-operations | Sandbox `exec`, `writeFile`, `readFile`, `listFiles`, and `destroy` go through policy and receipts instead of raw adapter objects. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P029 | open | High | Add approval grant expiry and scope checks | Approval grants include expiry, allowed capabilities, optional resource hints, and fail closed when stale or mismatched. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P030 | open | High | Add operation idempotency keys | Mutating operation specs accept idempotency keys, receipts record them, and adapters pass provider idempotency metadata where supported. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P031 | open | High | Add secret redaction profiles | Receipts, errors, logs, provider metadata, and debug output redact configured secret names and token-like values. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P032 | open | Medium | Add policy decision replay tests | Policy decisions can be reproduced from operation spec, default policy, approval grant, and adapter support level. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P033 | open | Medium | Add raw provider access guardrails | `raw()` documentation and tests make clear that raw access is ungoverned and should not be used for audited execution. | `pnpm test packages/core/src/core.test.ts && git diff --check` |
| CAP-P034 | open | Medium | Add receipt signing profile | Add optional receipt signatures with canonical payloads, key id metadata, and verification helpers. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P035 | open | Medium | Add evidence bundle export | Export receipts, logs, artifacts, policy decisions, and provider metadata as a verifiable bundle. | `pnpm test packages/core/src/core.test.ts` |

### Provider Adapter Lifecycle

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P036 | done | High | Make Kubernetes service ids round-trippable | `service.deploy` returns a Kubernetes resource name that `status` and `delete` can use; UIDs stay in receipt metadata. | `pnpm test packages/adapter-kubernetes/src/kubernetes.test.ts` |
| CAP-P037 | done | High | Clean up Kubernetes deployment after service failure | If Service creation fails after Deployment creation, the adapter best-effort deletes the Deployment and rethrows the original error. | `pnpm test packages/adapter-kubernetes/src/kubernetes.test.ts` |
| CAP-P038 | done | Medium | Propagate Fly forced machine deletion | `machine.destroy({ force: true })` sends the provider force query and live cleanup surfaces destroy errors. | `pnpm test packages/adapter-fly/src/fly.test.ts` |
| CAP-P039 | done | Medium | Reject unsupported Vercel traffic splits | Vercel `edge.release` rejects partial traffic values instead of silently promoting full alias traffic. | `pnpm test packages/adapter-vercel/src/vercel.test.ts` |
| CAP-P040 | done | High | Clean up Neon branch after connection URI failure | If optional connection URI fetch fails after branch creation, the adapter best-effort deletes the created branch. | `pnpm test packages/adapter-neon/src/neon.test.ts` |
| CAP-P041 | done | High | Clean up Cloudflare partial route creation | If a later route create fails, previously created routes for the deployment are best-effort deleted. | `pnpm test packages/adapter-cloudflare/src/cloudflare.test.ts` |
| CAP-P042 | open | High | Guard Azure persistent job updates | Azure job runs with user-provided names do not update existing persistent Jobs unless explicitly allowed. | `pnpm test packages/adapter-azure-container-apps/src/azure-container-apps.test.ts` |
| CAP-P043 | open | High | Clean up Azure jobs after start failure | If Azure Job create/update succeeds but execution start fails, the adapter cleans up generated jobs and reports cleanup metadata. | `pnpm test packages/adapter-azure-container-apps/src/azure-container-apps.test.ts` |
| CAP-P044 | open | Medium | Define Azure cancel cleanup semantics | `job.cancel` documents and tests whether it only stops execution or also deletes generated Job resources. | `pnpm test packages/adapter-azure-container-apps/src/azure-container-apps.test.ts && git diff --check` |
| CAP-P045 | open | Medium | Define Cloud Run traffic behavior | Cloud Run service release either supports traffic split semantics correctly or rejects unsupported partial traffic. | `pnpm test packages/adapter-cloud-run/src/cloud-run.test.ts` |
| CAP-P046 | open | High | Add ECS service rollback on partial failure | ECS service deploy cleans up task definitions or services created during a failed deployment path where provider APIs allow it. | `pnpm test packages/adapter-ecs/src/ecs.test.ts` |
| CAP-P047 | open | Medium | Add EC2 termination force semantics | EC2 machine destroy documents force behavior, records termination metadata, and does not hide failed termination. | `pnpm test packages/adapter-ec2/src/ec2.test.ts` |
| CAP-P048 | open | Medium | Bind Lambda job receipts to invocation ids | Lambda job receipts record request ids, function version or alias, log ids, and operation-bound capability path. | `pnpm test packages/adapter-lambda/src/lambda.test.ts` |
| CAP-P049 | open | High | Add Docker sandbox sub-operation receipts | Docker sandbox exec, file write, file read, list, and destroy emit governed receipts when wrapped by core. | `pnpm test packages/adapter-docker/src/docker.test.ts packages/core/src/core.test.ts` |
| CAP-P050 | open | Medium | Add E2B cleanup on create and exec errors | E2B sandbox creation and command execution failures record cleanup attempts and do not leak local state. | `pnpm test packages/adapter-e2b/src/e2b.test.ts` |
| CAP-P051 | open | Medium | Add Daytona cleanup on create and exec errors | Daytona sandbox creation and command execution failures record cleanup attempts and do not leak local state. | `pnpm test packages/adapter-daytona/src/daytona.test.ts` |
| CAP-P052 | open | Medium | Add Modal lifecycle edge-case tests | Modal adapter tests cover unsupported operations, sandbox destroy failure, and receipt metadata. | `pnpm test packages/adapter-modal/src/modal.test.ts` |
| CAP-P053 | open | High | Standardize adapter idempotency metadata | Real adapters use deterministic operation tags or provider idempotency keys where available. | `pnpm test packages/*/src/*.test.ts` |
| CAP-P054 | open | Medium | Classify provider retryable errors | Provider clients expose retryable, rate-limit, auth, validation, and unknown classifications without adding a large dependency. | `pnpm test packages/*/src/*.test.ts` |
| CAP-P055 | open | High | Expand adapter contract runner | Contract tests cover partial failures, cleanup metadata, receipt binding, policy denial, and unsupported capability errors. | `pnpm test packages/core/src/contract.ts packages/*/src/*.test.ts` |

### Live Provider Safety And Verification

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P056 | open | High | Add live test environment validator | A command checks required credentials, project ids, regions, and cost-risk flags before any live provider test starts. | `pnpm test packages/*/src/*.live.test.ts --runInBand` |
| CAP-P057 | open | High | Add live resource naming and TTL tags | Live tests apply deterministic names, owner tags, repo tags, and TTL metadata where providers support them. | `pnpm test packages/*/src/*.live.test.ts --runInBand` |
| CAP-P058 | open | Medium | Add live dry-run matrix | A script reports which live tests would run for the current environment without creating resources. | `node scripts/live-test-matrix.mjs --dry-run` |
| CAP-P059 | open | High | Add live cleanup sweep command | A cleanup command finds and deletes Capsule-tagged stale resources across supported providers. | `node scripts/live-cleanup-sweep.mjs --dry-run` |
| CAP-P060 | open | High | Add cost guardrails for live tests | Live tests require an explicit cost acknowledgement and max resource count before running billable providers. | `pnpm test packages/*/src/*.live.test.ts --runInBand` |
| CAP-P061 | open | Medium | Record provider API versions in live receipts | Live test receipts include provider region, API version, runtime version, and adapter version where available. | `pnpm test packages/*/src/*.live.test.ts --runInBand` |
| CAP-P062 | open | Medium | Quarantine flaky live tests | Live tests can be marked flaky with reason, last observed failure, owner, and revalidation command. | `git diff --check` |
| CAP-P063 | open | Medium | Add minimal credential checker docs | Docs list the minimum credentials for each live adapter and the command that validates them without side effects. | `git diff --check` |
| CAP-P064 | open | Medium | Add CI-safe live test opt-in | CI live tests run only with explicit labels or env flags and never run on untrusted forks. | `git diff --check && pnpm test` |
| CAP-P065 | open | Low | Add golden live receipt samples | Store sanitized example receipts for each provider to document real metadata shape. | `git diff --check && pnpm release:markers` |

### CLI And Developer Experience

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P066 | open | High | Add `capsule doctor` | CLI reports package versions, Node version, workspace health, provider env availability, and release audit status. | `pnpm test packages/cli/src/*.test.ts && pnpm typecheck` |
| CAP-P067 | open | Medium | Add `capsule capabilities` | CLI prints adapter support levels as table and JSON, including unsupported and experimental capabilities. | `pnpm test packages/cli/src/*.test.ts` |
| CAP-P068 | open | High | Add `capsule policy explain` | CLI explains why a spec is allowed or denied under a policy without executing a provider action. | `pnpm test packages/cli/src/*.test.ts packages/core/src/core.test.ts` |
| CAP-P069 | open | High | Add receipt verify command | CLI verifies receipt schema, optional signatures, redaction status, and store readability. | `pnpm test packages/cli/src/*.test.ts packages/core/src/core.test.ts` |
| CAP-P070 | open | Medium | Add preview create and destroy CLI flow | CLI can create a preview from a config file and destroy it using recorded cleanup plans. | `pnpm test packages/cli/src/*.test.ts packages/preview/src/*.test.ts` |
| CAP-P071 | open | Medium | Add project init command | CLI creates a minimal Capsule config, example policy, and adapter install hint without adding secrets. | `pnpm test packages/cli/src/*.test.ts` |
| CAP-P072 | open | Medium | Add runnable examples command | CLI can list and run local examples with mock adapters and no provider credentials. | `pnpm test packages/cli/src/*.test.ts` |
| CAP-P073 | open | High | Improve actionable error messages | Common errors include provider, capability path, remediation, docs link, and safe retry guidance. | `pnpm test packages/core/src/core.test.ts packages/cli/src/*.test.ts` |
| CAP-P074 | open | Medium | Add JSON output mode | CLI commands support stable JSON output for automation and table output for humans. | `pnpm test packages/cli/src/*.test.ts` |
| CAP-P075 | open | Low | Add shell completions | CLI can generate shell completion scripts for bash, zsh, and fish without adding a heavy framework. | `pnpm test packages/cli/src/*.test.ts` |

### SDK And API Quality

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P076 | open | High | Audit public type exports | Every public type is intentional, documented, and reachable from package exports without deep imports. | `pnpm docs:api && git diff --exit-code docs/api-reference.md` |
| CAP-P077 | open | High | Add public API stability tests | Tests import all public packages through their package names and fail on missing or accidental exports. | `pnpm test packages/core/src/package-exports.test.ts` |
| CAP-P078 | open | Medium | Expand contract fixtures | Add reusable fixtures for allow, deny, unsupported, partial failure, cleanup, receipt, and live-skip cases. | `pnpm test packages/core/src/core.test.ts packages/*/src/*.test.ts` |
| CAP-P079 | open | High | Normalize error taxonomy | Core and adapters use typed errors for unsupported capability, policy denial, provider auth, provider validation, provider rate limit, and cleanup failure. | `pnpm test packages/core/src/core.test.ts packages/*/src/*.test.ts` |
| CAP-P080 | open | Medium | Refine capability query types | Capability paths are typed tightly enough that unsupported string literals fail at compile time in SDK examples. | `pnpm typecheck` |
| CAP-P081 | open | High | Strengthen preview cleanup plans | Preview orchestration stores cleanup plans that are reversible, idempotent, and visible in receipts. | `pnpm test packages/preview/src/*.test.ts packages/core/src/core.test.ts` |
| CAP-P082 | open | Medium | Validate presets without heavy dependencies | Presets validate required fields and policy compatibility using local TypeScript helpers instead of a large schema library. | `pnpm test packages/core/src/core.test.ts packages/presets/src/*.test.ts` |
| CAP-P083 | open | Medium | Add AI wrapper end-to-end examples | AI wrappers show a governed runtime action with policy check, receipt capture, and no secret leakage. | `pnpm test packages/ai/src/*.test.ts && git diff --check` |
| CAP-P084 | open | Medium | Add tested package import snippets | README and docs snippets are backed by small TypeScript compile tests. | `pnpm typecheck && pnpm test` |
| CAP-P085 | open | Low | Add migration notes for v1 to v2 | Docs explain expected breaking changes and how to migrate policies, receipts, and adapter configs. | `git diff --check` |

### Product And Commercial Surface

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P086 | open | High | Define Capsule Cloud product thesis | Add a concrete doc for the hosted product: project control plane, policy firewall, receipt archive, live provider orchestration, and audit UI. | `git diff --check` |
| CAP-P087 | open | High | Design org and project model | Define orgs, projects, environments, provider accounts, policy bundles, users, roles, and audit boundaries. | `git diff --check` |
| CAP-P088 | open | High | Define managed credential vault boundary | Document what secrets a hosted Capsule product stores, what stays external, rotation requirements, and never-log rules. | `git diff --check` |
| CAP-P089 | open | Medium | Define pricing and packaging model | Draft OSS, team, business, and enterprise packaging tied to real operational value, not artificial SDK limits. | `git diff --check` |
| CAP-P090 | open | High | Specify audit dashboard data contract | Define dashboard entities for operations, receipts, policies, approvals, provider calls, cleanup status, and evidence bundles. | `git diff --check` |
| CAP-P091 | open | Medium | Add enterprise policy bundle examples | Add examples for no-network sandbox, preview-only deploys, max-cost jobs, approval-required releases, and TTL-limited resources. | `pnpm test packages/core/src/core.test.ts && git diff --check` |
| CAP-P092 | open | Medium | Add hosted API boundary sketch | Define which APIs remain OSS-local and which APIs would exist only in a managed control plane. | `git diff --check` |
| CAP-P093 | open | Medium | Add sales-demo scenario | Build a repeatable demo script for agent-created preview environment with database branch, edge deploy, policy check, receipt, and cleanup. | `git diff --check && pnpm test` |
| CAP-P094 | open | Medium | Define open-core boundary | Document what must stay OSS to preserve trust and what can be paid hosted convenience. | `git diff --check` |
| CAP-P095 | open | Low | Add customer discovery question bank | Add a short internal doc for validating whether agent teams pay for policy, receipts, live-provider orchestration, or audit export. | `git diff --check` |

### Operations, Support, And Community

| ID | Status | Priority | Title | Acceptance criteria | Verification |
| --- | --- | --- | --- | --- | --- |
| CAP-P096 | open | Medium | Add structured telemetry interface | Add optional telemetry hooks for operation start, policy decision, provider call, cleanup, receipt write, and error classification. | `pnpm test packages/core/src/core.test.ts` |
| CAP-P097 | open | Medium | Add OpenTelemetry integration sketch | Document how telemetry hooks map to spans, attributes, redaction, and provider resource ids without forcing OTel as a core dependency. | `git diff --check` |
| CAP-P098 | open | Medium | Add support bundle export | CLI can export sanitized config, package versions, capability matrix, recent receipts, and redacted errors for debugging. | `pnpm test packages/cli/src/*.test.ts` |
| CAP-P099 | open | Low | Add incident and cleanup runbooks | Docs cover leaked provider resources, failed releases, corrupted receipt stores, compromised credentials, and live-test cost incidents. | `git diff --check` |
| CAP-P100 | open | Medium | Add maintainer release checklist | Maintainer docs list branch state, CI gates, pack smoke, provenance, npm publish, docs refresh, tag, and post-release verification. | `git diff --check && pnpm release:audit` |

## First Parallel Execution Wave

Start the next wave with non-overlapping ownership:

1. Core security agent: CAP-P025, then CAP-P026 if interfaces stay stable.
2. Provider lifecycle agent: CAP-P042 and CAP-P043 in Azure Container Apps.
3. Docs truth agent: CAP-P015, CAP-P016, and CAP-P019 after core behavior is confirmed.
4. CLI/DX agent: CAP-P066 and CAP-P068 after core policy explain APIs are stable.
5. Release agent: CAP-P003 and CAP-P004 without touching runtime packages.

The core security lane gates the next public release. Provider and CLI lanes can proceed in parallel as long as they do not change core interfaces without review.
