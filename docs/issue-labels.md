# Issue Labels

Capsule uses labels to keep productization work reviewable and parallel-agent safe.

## Area Labels

| Label             | Use for                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `area:core`       | `@capsule/core`, capability model, policy model, receipt creation, adapter contracts, shared errors, and public SDK types.                            |
| `area:adapter`    | One provider adapter package, provider client code, adapter-specific lifecycle behavior, and adapter tests. Pair with a provider label when possible. |
| `area:store`      | Receipt stores, durability checks, JSONL, SQLite, and future append-only persistence.                                                                 |
| `area:cli`        | `@capsule/cli`, command output, local config, doctor commands, support bundles, and human/operator UX.                                                |
| `area:docs`       | README, public docs, ADRs, examples, quickstarts, and public project positioning.                                                                     |
| `area:release`    | Changesets, package metadata, provenance, pack smoke, CI, npm publish, and release rollback work.                                                     |
| `area:live-tests` | Credential checks, provider live tests, cleanup sweeps, cost gates, and sanitized live receipts.                                                      |
| `area:product`    | Hosted/commercial control-plane design, org/project model, policy bundles, evidence dashboard, and open-core boundary.                                |
| `area:ops`        | Telemetry, runbooks, incident response, support export, and maintainer operations.                                                                    |

## Provider Labels

| Label                           | Use for                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `provider:docker`               | Docker adapter behavior and local runtime examples.                              |
| `provider:e2b`                  | E2B sandbox adapter and live verification.                                       |
| `provider:daytona`              | Daytona workspace adapter and live verification.                                 |
| `provider:modal`                | Modal sandbox adapter and live verification.                                     |
| `provider:cloud-run`            | Google Cloud Run jobs, services, logs, and release behavior.                     |
| `provider:cloudflare`           | Cloudflare Workers deployment, routes, versions, rollback, and bindings.         |
| `provider:vercel`               | Vercel deployments, aliases, logs, rollback, and edge semantics.                 |
| `provider:neon`                 | Neon branches, connection URIs, migrations, and cleanup.                         |
| `provider:kubernetes`           | Kubernetes Jobs, Deployments, Services, namespaces, and logs.                    |
| `provider:lambda`               | AWS Lambda invocation and execution metadata.                                    |
| `provider:ecs`                  | ECS/Fargate tasks, services, clusters, and cleanup.                              |
| `provider:ec2`                  | EC2 machines, lifecycle, networking, and termination behavior.                   |
| `provider:fly`                  | Fly Machines jobs, machines, force deletion, and cleanup.                        |
| `provider:azure-container-apps` | Azure Container Apps jobs, services, executions, and generated resource cleanup. |
| `provider:mock`                 | Mock adapter behavior, fixtures, and example-only provider modeling.             |

## Risk Labels

| Label                  | Use for                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `risk:security`        | Policy bypasses, receipt trust, secret handling, signing, auth, IAM, or provider permission boundaries.     |
| `risk:billing`         | Work that may leak paid resources, change cleanup behavior, or affect live-test/provider costs.             |
| `risk:breaking-change` | Public API changes, behavior changes, package exports, or adapter contract changes.                         |
| `risk:live-provider`   | Requires real provider credentials or may create live cloud resources during verification.                  |
| `risk:evidence`        | Receipt durability, signatures, redaction, audit export, evidence bundles, or FIDES-style trust boundaries. |

## Work Type Labels

| Label          | Use for                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `type:bug`     | Incorrect behavior, broken verification, provider leaks, or misleading runtime result.   |
| `type:feature` | New public capability, CLI command, adapter behavior, store feature, or product surface. |
| `type:docs`    | Documentation-only changes.                                                              |
| `type:test`    | Test coverage, fixtures, contract runner additions, and live-test harness work.          |
| `type:chore`   | Maintenance, release tooling, cleanup, metadata, and non-runtime repo hygiene.           |
| `type:adr`     | Architecture decision records and contract-level decisions.                              |

## Priority Labels

| Label         | Use for                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `priority:p0` | Blocks release, can leak paid resources, weakens security, or makes evidence false. |
| `priority:p1` | Important for first public release or credible OSS adoption.                        |
| `priority:p2` | Valuable product polish or follow-up once the release gate is safe.                 |
| `priority:p3` | Nice-to-have, example expansion, or exploratory work.                               |

## Execution Labels

| Label                      | Use for                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `agent:parallel-safe`      | Can be delegated to a parallel agent with a narrow file ownership set.                                        |
| `agent:needs-main-review`  | Touches shared interfaces, security semantics, release gates, or multiple packages.                           |
| `agent:do-not-parallelize` | Needs serialized work because it touches shared generated files, package metadata, or active migration state. |
| `good-first-issue`         | Small, low-risk issue with clear files, tests, and expected behavior.                                         |
| `needs-live-verification`  | Local tests are not enough; maintainer must run opt-in live provider checks.                                  |

## Default Label Sets

- Core security fix: `area:core`, `risk:security`, `risk:evidence`, `type:bug`, `priority:p0`, `agent:needs-main-review`.
- Single adapter lifecycle fix: `area:adapter`, one `provider:*`, `risk:billing`, `type:bug`, `priority:p0`, `agent:parallel-safe`.
- Release tooling change: `area:release`, `type:chore`, `priority:p1`, `agent:needs-main-review`.
- Docs truth update: `area:docs`, `type:docs`, `priority:p1`, `agent:parallel-safe`.
- Live provider harness change: `area:live-tests`, one or more `provider:*`, `risk:live-provider`, `type:test`, `priority:p1`, `needs-live-verification`.
