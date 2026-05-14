# Provider Selection

Provider choice in Capsule starts from workflow requirements, not from provider preference. A provider is a fit only when its adapter declares the required capability paths at acceptable support levels and the operator can verify the real account path without leaking credentials into docs, logs, or receipts.

Use this document with the [provider matrix](provider-matrix.md), [capability model](capability-model.md), and [real provider quickstarts](real-provider-quickstarts.md).

## Support Levels

- `native`: the provider exposes the capability directly and the adapter uses that API.
- `emulated`: Capsule or the adapter approximates the behavior outside the provider's native model.
- `experimental`: the adapter exposes the capability, but semantics, coverage, or provider behavior still need explicit verification.
- `unsupported`: the adapter does not implement the capability; public calls must fail rather than fake it.

`supports(path)` accepts `native`, `emulated`, and `experimental`. For production workflows, prefer requirement sets that name acceptable levels explicitly.

## Requirement Sets

Local trusted code execution:

```ts
const localExecutionRequirements = [
  { path: "sandbox.create", levels: ["native"] },
  { path: "sandbox.exec", levels: ["native"] },
  { path: "sandbox.fileWrite", levels: ["native", "emulated"] },
  { path: "sandbox.destroy", levels: ["native"] },
  { path: "sandbox.networkPolicy", levels: ["native", "experimental"], optional: true, reason: "Used for network-off runs" }
];
```

Database branch for a preview:

```ts
const previewDatabaseRequirements = [
  { path: "database.branchCreate", levels: ["native"] },
  { path: "database.branchDelete", levels: ["native"] },
  { path: "database.connectionString", levels: ["native"] },
  { path: "database.branchReset", levels: ["native"], optional: true, reason: "Useful for repeatable preview refresh" }
];
```

Edge deployment:

```ts
const edgeDeploymentRequirements = [
  { path: "edge.deploy", levels: ["native"] },
  { path: "edge.url", levels: ["native", "experimental"], optional: true, reason: "Provider may return a URL differently" },
  { path: "edge.logs", levels: ["native"], optional: true, reason: "Required only for runtime log inspection" },
  { path: "edge.rollback", levels: ["native"], optional: true, reason: "Required for operator rollback flows" }
];
```

Machine-backed one-shot job:

```ts
const machineJobRequirements = [
  { path: "job.run", levels: ["native"] },
  { path: "job.env", levels: ["native"] },
  { path: "machine.create", levels: ["native"], optional: true, reason: "Required when the job is backed by an inspectable machine" },
  { path: "machine.destroy", levels: ["native"], optional: true, reason: "Required for explicit cleanup" }
];
```

## Compatibility Scoring

Scores are workflow-specific. They are not global provider rankings.

```ts
import { providerCompatibilityScore, explainSupportLevel } from "@capsule/core";
import { docker } from "@capsule/adapter-docker";
import { neon } from "@capsule/adapter-neon";

const candidates = [
  { name: "Docker", capabilities: docker().capabilities },
  { name: "Neon", capabilities: neon().capabilities }
];

for (const candidate of candidates) {
  const score = providerCompatibilityScore(candidate.capabilities, previewDatabaseRequirements);
  console.log(candidate.name, score.score, score.missingRequired);
  console.log(explainSupportLevel(candidate.capabilities, "database.branchCreate"));
}
```

Interpretation:

- A provider with missing required capabilities is not a fit for that workflow, even if its optional score is high.
- `native` required support is appropriate for production deploy, database, rollback, and cleanup flows.
- `experimental` can be acceptable for local workflows or gated previews when the operator explicitly opts in.
- `emulated` can be acceptable for developer convenience, but do not present it as provider-native behavior.

## Current Provider Choices

| Workflow | Prefer | Why | Avoid when |
| --- | --- | --- | --- |
| Local trusted sandbox or one-shot job | Docker | `sandbox.create`, `sandbox.exec`, file operations, `sandbox.destroy`, and `job.run` are native; no cloud credentials are needed. | The code is hostile or the workflow needs cloud isolation, provider IAM, managed networking, or remote service lifecycle. |
| Preview database branch | Neon | `database.branchCreate`, `database.branchDelete`, `database.branchReset`, and `database.connectionString` are native. | You need migrations, snapshots, restore, or full preview orchestration as one native provider object. |
| Worker-style edge deployment | Cloudflare Workers | `edge.deploy`, `edge.version`, `edge.rollback`, and `edge.routes` are native; `edge.url` is experimental. | You require native log reads, secret/binding management, gradual rollout, or database/resource primitives through the same adapter. |
| Web or edge deployment with URL, status, release, and logs | Vercel | `edge.deploy`, `edge.status`, `edge.release`, `edge.logs`, and `edge.url` are native in the adapter. | You require rollback, routes, provider env management, large source upload/SHA flow, or preview orchestration through Capsule today. |
| Machine-backed job or low-level machine lifecycle | Fly Machines | `job.run`, `job.env`, `machine.create`, `machine.status`, `machine.start`, `machine.stop`, and `machine.destroy` are native; resources and machine network are experimental. | You require service deploy, logs, volumes, app networking, snapshots, or machine exec through Capsule today. |

## Selection Examples

Choose Docker when the requirement is fast local execution:

```ts
const score = providerCompatibilityScore(docker().capabilities, localExecutionRequirements);

if (score.missingRequired.length > 0) {
  throw new Error("Docker does not satisfy the local execution requirement set.");
}
```

Docker is the right default for examples, local CI, and trusted scripts. It is not a hostile-code boundary by default, and `sandbox.networkPolicy` is currently experimental while filesystem and secret mounting behavior are adapter-side.

Choose Neon when the workflow needs a real database branch:

```ts
const score = providerCompatibilityScore(neon().capabilities, previewDatabaseRequirements);
```

Neon is the right fit for branch lifecycle and connection URI retrieval. The adapter does not claim migrations, snapshots, restore, or provider-native preview orchestration.

Choose Cloudflare when the unit is a Worker:

```ts
const cloudflareEdgeRequirements = [
  { path: "edge.deploy", levels: ["native"] },
  { path: "edge.version", levels: ["native"] },
  { path: "edge.rollback", levels: ["native"] },
  { path: "edge.routes", levels: ["native"], optional: true }
];
```

Cloudflare is the right fit when the deployable is explicitly a Worker and route/version semantics matter. Do not choose it for generic services, jobs, sandboxes, logs, bindings, or database primitives unless those capabilities are added and verified.

Choose Vercel after credentials are available when the workflow needs deployment status, URLs, release, and bounded logs:

```ts
const vercelReleaseRequirements = [
  { path: "edge.deploy", levels: ["native"] },
  { path: "edge.status", levels: ["native"] },
  { path: "edge.release", levels: ["native"] },
  { path: "edge.url", levels: ["native"] },
  { path: "edge.logs", levels: ["native"], optional: true }
];
```

Vercel is pending live account verification until `VERCEL_TOKEN` and the needed Capsule Vercel settings are configured in an operator environment. Public docs should name required environment variables, not values.

Choose Fly after credentials are available when the workflow needs one-shot machines or explicit machine lifecycle:

```ts
const flyJobRequirements = [
  { path: "job.run", levels: ["native"] },
  { path: "job.env", levels: ["native"] },
  { path: "machine.create", levels: ["native"] },
  { path: "machine.destroy", levels: ["native"] }
];
```

Fly is pending live account verification until `FLY_API_TOKEN`, `FLY_APP_NAME`, and an allowed image are configured in an operator environment. Treat logs, volumes, services, app networking, snapshots, and exec as unavailable through Capsule until they are implemented and documented.

## Credential Boundary

Provider selection docs should stay public and secret-free:

- document environment variable names, never values;
- do not include account IDs, project IDs, deployment IDs, connection strings, branch names from real accounts, bearer tokens, signed URLs, or provider console URLs;
- run live verification only behind `CAPSULE_LIVE_TESTS=1` and provider-specific credentials;
- persist receipts only after checking they do not contain raw secrets or connection strings;
- record "pending credentials" as an operator state, not as adapter support.

Support level is about the adapter contract. Credential availability is about whether the current operator can verify that provider today. Keep those separate.
