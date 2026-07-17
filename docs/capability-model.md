# Capability Model

Capsule capability paths use dot notation, such as `sandbox.exec`, `service.deploy`, `edge.deploy`, `database.branchCreate`, and `machine.create`.

`supportLevel(path)` returns the declared support level. `supports(path)` returns true for `native`, `emulated`, and `experimental`, and false for `unsupported`.

## Support Levels

- `native`: the provider exposes the capability directly and the adapter uses that API.
- `emulated`: Capsule or the adapter approximates the behavior outside the provider's native model.
- `experimental`: the adapter exposes the capability, but semantics, coverage, or provider behavior still need explicit verification.
- `unsupported`: the adapter does not implement the capability; public calls must fail rather than fake it.

Support level is about the adapter contract, not about whether the current operator can reach the provider today. For production workflows, prefer requirement sets that name acceptable levels explicitly.

## Requirement Sets

Callers can evaluate a group of required and optional capability paths before choosing an adapter:

```ts
import { evaluateCapabilityRequirements, missingCapabilityRequirements } from "@capsule-sdk/core";

const requirements = [
  "sandbox.create",
  "sandbox.exec",
  "sandbox.fileWrite",
  { path: "sandbox.snapshot", optional: true, reason: "Used only for checkpointing" }
];

const results = evaluateCapabilityRequirements(capsule.capabilities(), requirements);
const missing = missingCapabilityRequirements(capsule.capabilities(), requirements);
```

By default, `native`, `emulated`, and `experimental` satisfy a requirement. Use `levels: ["native"]` when a workflow must reject emulation or experimental provider behavior.

`capabilityDiff(left, right)` compares two provider maps and returns only paths where support levels differ. This is useful for `capsule compare providers`, preset validation, and generated provider matrices.

`explainSupportLevel(capabilities, path)` returns a human-readable summary and guidance for a declared support level. Use it in CLIs, docs generators, and provider selection UIs instead of inventing per-command wording.

`providerCompatibilityScore(capabilities, requirements)` returns a 0-100 score for a workflow requirement set. Required capabilities account for most of the score, optional capabilities add a smaller bonus, and support levels are weighted as `native > emulated > experimental > unsupported`. This is not a universal provider ranking; it is a transparent fit score for one explicit workflow.

## CLI Inspection

`capsule capabilities --adapter <provider>` prints a table for humans. The table includes every declared capability path, including `unsupported` and `experimental` entries, so operators can see gaps before attempting an action.

Use `--explain` to replace the short summary column with remediation guidance:

```bash
capsule capabilities --adapter docker --explain
```

Use `--json` for automation. The JSON report includes the adapter name, the raw capability map, and normalized explanation entries:

```bash
capsule capabilities --adapter docker --json
```

Examples:

- Docker: `sandbox.exec` and `sandbox.exposePort` are native, `sandbox.filesystemPolicy` is emulated, `sandbox.networkPolicy` is experimental, `sandbox.snapshot` and `sandbox.restore` are unsupported, and `service.deploy` is unsupported. Docker sandbox port exposure is local-only by default: requested ports are published to `127.0.0.1` unless a caller explicitly supplies another `hostIp`.
- E2B: `sandbox.create`, `sandbox.exec`, and sandbox file operations are native through the E2B SDK; create and thrown exec failures attach best-effort cleanup metadata when Capsule attempts sandbox kill. Jobs remain unsupported until Capsule models an explicit E2B-backed job flow.
- Daytona: sandbox lifecycle, command execution, and file operations are native through the Daytona SDK; create and thrown exec failures attach best-effort cleanup metadata when Capsule attempts sandbox deletion. Job and preview behavior remain unsupported until explicit public wrappers exist.
- Modal: sandbox lifecycle, command execution, and file read/write are native through the Modal JS SDK; create, exec, and destroy receipts include provider-specific metadata, while file listing and broader function/service/preview workflows remain unsupported.
- Cloud Run: jobs and services are native through the real Cloud Run Admin API adapter; job execution status and cancel map to the Cloud Run Execution API when the caller has the execution resource name. Service update is native through `services.patch` with revision-producing template updates, and service rollback is native full traffic migration to an explicit revision or the selected previous revision from the service revision list. Partial service traffic splits are rejected until Capsule models split-release state explicitly. Job and service logs are native bounded reads through Cloud Logging `entries:list` using Cloud Run monitored-resource filters. Execution delete is not treated as cancel because it removes the execution resource/list entry. IAM/public access, source builds, follow-mode log streaming, and preview orchestration are intentionally not faked.
- Vercel: edge deployment, deployment status, full alias release, bounded deployment event logs, and project runtime logs are native through the real Vercel REST adapter. Runtime logs require a Vercel project id, and follow-mode log streaming is rejected until Capsule has bounded streaming semantics. Release traffic splits other than 100% are rejected until canary/split-release semantics are modeled explicitly. Service/preview semantics, full source upload flows, env configuration, route management, and rollback are not faked.
- Cloudflare: real Worker upload is native through `edge.deploy`; Worker version creation is native through `edge.version`; Worker rollback is native through `edge.rollback`; sandbox, job, service, database, and preview are unsupported until implemented by the real adapter.
- Real Cloudflare adapter: `edge.deploy` is native for Worker module upload and route creation, `edge.version` is native for Workers Versions API upload, and `edge.rollback` is native for creating a Workers Deployment to a selected version. Logs, secret bindings, provider-specific bindings, and gradual traffic-split release remain unsupported until modeled as explicit operations.
- Neon: database branch creation, deletion, reset, and connection strings are native.
- Lambda: existing function invoke is native for `job.run`. Receipts record the SDK request id, requested qualifier, executed function version, log tail request id when AWS returns one, and the operation-bound `job.run` capability path. Deployment, environment mutation, and Lambda@Edge remain future explicit capabilities.
- ECS/Fargate: existing task definitions can be run as jobs and services natively; task definition registration, load balancers, logs, and service discovery remain future explicit capabilities.
- Kubernetes: jobs and services are native through the real Kubernetes adapter. Service deploy creates a Deployment and Service, service status reads both resources, service delete removes both resources in the configured namespace, and URLs prefer assigned LoadBalancer ingress before falling back to in-cluster DNS. Job and service logs are native when a Job selector or Service selector can identify Pods; Capsule reads combined Pod logs without alpha split-stream query parameters and rejects follow-mode streaming until bounded streaming is modeled. Sandbox, preview, and machine support remain unsupported until explicit public wrappers exist.
- Azure Container Apps: jobs and services are native through the ARM Container Apps API. Job status reads an execution resource, job cancel stops an execution, service status reads the Container App resource, and service delete deletes the Container App. Revision activate/deactivate ARM APIs are not exposed as generic rollback until Capsule has a service rollback contract.
- EC2: `machine.create`, `machine.status`, `machine.start`, `machine.stop`, and `machine.destroy` are native through the real EC2 adapter. `machine.destroy` records current and previous EC2 states plus force/skip-OS-shutdown settings, and it fails if EC2 does not return termination state. Job/service wrappers, exec, and snapshot remain unsupported until modeled explicitly.

## Choosing A Provider

Provider choice starts from workflow requirements, not from provider preference. A provider is a fit only when its adapter declares the required capability paths at acceptable support levels and the operator can verify the real account path without leaking credentials into docs, logs, or receipts. Build a requirement set for the workflow, score candidates with `providerCompatibilityScore`, and read `explainSupportLevel` for the load-bearing paths:

```ts
import { providerCompatibilityScore, explainSupportLevel } from "@capsule-sdk/core";
import { docker } from "@capsule-sdk/docker";
import { neon } from "@capsule-sdk/neon";

const previewDatabaseRequirements = [
  { path: "database.branchCreate", levels: ["native"] },
  { path: "database.branchDelete", levels: ["native"] },
  { path: "database.connectionString", levels: ["native"] },
  { path: "database.branchReset", levels: ["native"], optional: true, reason: "Repeatable preview refresh" }
];

for (const candidate of [
  { name: "Docker", capabilities: docker().capabilities },
  { name: "Neon", capabilities: neon().capabilities }
]) {
  const score = providerCompatibilityScore(candidate.capabilities, previewDatabaseRequirements);
  console.log(candidate.name, score.score, score.missingRequired);
}
```

Interpretation:

- A provider with missing required capabilities is not a fit, even if its optional score is high.
- `native` required support is appropriate for production deploy, database, rollback, and cleanup flows.
- `experimental` can be acceptable for local workflows or gated previews when the operator explicitly opts in.
- `emulated` can be acceptable for developer convenience, but do not present it as provider-native behavior.

Current provider fit:

| Workflow                                            | Prefer             | Why                                                                                                                              | Avoid when                                                                                                                 |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Local trusted sandbox or one-shot job               | Docker             | `sandbox.create`, `sandbox.exec`, file operations, `sandbox.destroy`, and `job.run` are native; no cloud credentials needed.     | Code is hostile or the workflow needs cloud isolation, provider IAM, managed networking, or remote service lifecycle.      |
| Preview database branch                             | Neon               | `database.branchCreate/branchDelete/branchReset/connectionString` are native.                                                    | You need migrations, snapshots, restore, or full preview orchestration as one native provider object.                      |
| Worker-style edge deployment                        | Cloudflare Workers | `edge.deploy`, `edge.version`, `edge.rollback`, and `edge.routes` are native; `edge.url` is experimental.                        | You require native log reads, secret/binding management, gradual rollout, or database primitives through the same adapter. |
| Web/edge deployment with URL, status, release, logs | Vercel             | `edge.deploy`, `edge.status`, `edge.release`, `edge.logs`, and `edge.url` are native.                                            | You require rollback, routes, provider env management, large source upload/SHA flow, or preview orchestration today.       |
| Machine-backed job or low-level machine lifecycle   | Fly Machines       | `job.run`, `job.env`, and `machine.create/status/start/stop/destroy` are native; resources and machine network are experimental. | You require service deploy, logs, volumes, app networking, snapshots, or machine exec today.                               |

Vercel and Fly are pending live account verification until their credential environment variables are configured in an operator environment. Record "pending credentials" as an operator state, not as adapter support.

## Credential Boundary

Provider selection docs must stay public and secret-free:

- document environment variable names, never values;
- do not include account IDs, project IDs, deployment IDs, connection strings, real branch names, bearer tokens, signed URLs, or provider console URLs;
- run live verification only behind `CAPSULE_LIVE_TESTS=1` and provider-specific credentials;
- persist receipts only after checking they contain no raw secrets or connection strings.

Support level is about the adapter contract. Credential availability is about whether the current operator can verify that provider today. Keep those separate.
