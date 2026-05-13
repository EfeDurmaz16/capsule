# Comparison

Capsule is not trying to replace the tools below. The point of this comparison is to keep Capsule's boundary honest: a small TypeScript adapter/spec layer for runtime actions, capability negotiation, policy notes, logs, artifacts, and receipts.

## Summary Table

| Project | What it is | Source | Capsule boundary |
| --- | --- | --- | --- |
| files-sdk | Unified object/blob storage SDK with adapters and native escape hatches. | [files-sdk.dev](https://files-sdk.dev/) | Capsule borrows the adapter discipline, but compute and deployment need domain-specific primitives, support levels, and policy/receipt evidence. |
| ComputeSDK | TypeScript toolkit for running code in sandboxes through separate provider packages. | [github.com/computesdk/computesdk](https://github.com/computesdk/computesdk) | Capsule overlaps in sandbox execution but expands the contract to jobs, services, edge, database resources, previews, machines, policy notes, and receipts. |
| E2B | Code interpreter and sandbox SDKs for AI-generated code. | [github.com/e2b-dev/code-interpreter](https://github.com/e2b-dev/code-interpreter) | E2B is a provider target. Capsule should adapt to it, not abstract away its sandbox semantics. |
| Daytona | Secure elastic sandbox infrastructure and SDKs for AI-generated code. | [daytona.io/docs](https://www.daytona.io/docs/) | Daytona is a provider target for the sandbox domain; Capsule should preserve Daytona-specific workspace/runtime behavior. |
| Modal | Cloud platform for functions and sandboxes, with Python-first and JS/Go SDK surfaces. | [Modal sandbox docs](https://modal.com/docs/guide/sandbox), [Modal JS/Go SDK docs](https://modal.com/docs/guide/sdk-javascript-go) | Modal is both a sandbox and job/function provider target. Capsule should mark unsupported or experimental features explicitly instead of pretending parity with Docker or E2B. |
| Dagger | Programmable container/workflow engine for application delivery and CI/CD. | [Dagger programmability docs](https://docs.dagger.io/features/programmability/) | Dagger owns workflow execution. Capsule can be called by CI/workflow engines but is not a pipeline engine. |
| Nitric | Declarative cloud application framework for APIs, databases, queues, buckets, and related resources. | [Nitric docs](https://nitric.io/docs) | Nitric owns app architecture and cloud resource declaration. Capsule owns runtime action contracts and receipts. |
| Encore | Backend framework and cloud platform that derives infrastructure from application code. | [Encore infrastructure docs](https://encore.dev/docs/deploy/infra) | Encore owns app/runtime framework semantics. Capsule should not require users to adopt an application framework. |
| Terraform | Infrastructure as code tool with provider plugins and state mapping remote objects to config. | [Terraform docs](https://developer.hashicorp.com/terraform/docs), [Terraform state docs](https://docs.hashicorp.com/terraform/language/state) | Terraform owns desired-state infrastructure management. Capsule owns runtime operations and observational receipts, not full infrastructure state. |
| Pulumi | Infrastructure as code platform using general-purpose languages and provider SDKs. | [Pulumi docs](https://www.pulumi.com/docs/) | Pulumi owns provisioning/state/update workflows. Capsule may trigger runtime actions or previews but should not become an IaC engine. |
| Vercel APIs/SDK | Provider API/SDK for deployments, domains, projects, env vars, and related platform objects. | [Vercel REST API docs](https://vercel.com/docs/rest-api) | Vercel is an edge/deployment provider target. Capsule wraps edge/deployment receipts and support levels while preserving Vercel-specific escape hatches. |
| Cloudflare Workers APIs | Provider APIs for Workers scripts and global serverless deployment. | [Cloudflare Workers](https://www.cloudflare.com/developer-platform/workers/), [Workers API docs](https://developers.cloudflare.com/workers/api/) | Cloudflare is an edge/resource provider target. Capsule should model bindings/routes explicitly instead of flattening Workers into generic services. |

## files-sdk

files-sdk is the closest design inspiration. It presents a small storage surface across object/blob providers and still leaves an escape hatch when users need the native client.

Capsule copies that discipline but cannot copy the exact abstraction style. Storage has a relatively stable common slice: upload, download, list, head, delete. Runtime providers differ more sharply. A sandbox, a Cloud Run job, a Vercel deployment, a Neon branch, and an EC2 instance are not interchangeable resources. Capsule therefore uses domain primitives and support levels rather than one universal `run` or `deploy`.

## ComputeSDK

ComputeSDK is close to Capsule's sandbox slice. Its public README describes separate provider packages and a common sandbox interface for code execution, filesystem, and terminal-like capabilities.

Capsule should treat ComputeSDK as adjacent rather than obsolete. The difference is scope and evidence:

- ComputeSDK centers on running code in sandboxes.
- Capsule covers sandbox, job, service, edge, database/resource, preview, and machine domains.
- Capsule requires explicit capability support levels.
- Capsule makes policy decisions, logs, artifacts, and receipts part of the contract.

The risk for Capsule is overreach. The comparison with ComputeSDK is a reminder to keep the sandbox API small and avoid turning every provider detail into a fake common denominator.

## Sandbox Providers: E2B, Daytona, Modal

E2B, Daytona, and Modal provide runtime infrastructure. Capsule should integrate with them as adapters, not compete with their isolation layers.

The honest Capsule position:

- E2B is a strong target for AI code interpreter and sandbox workflows.
- Daytona is a strong target for sandbox/workspace workflows where a complete isolated computer model matters.
- Modal spans sandboxes and cloud functions, but its strongest native platform model is not identical to Docker, E2B, or Cloud Run.

Capsule should expose the overlap through `sandbox` and `job` capabilities while preserving provider-specific raw access for details such as templates, persistence, images, mounts, GPUs, regions, and provider-native lifecycle controls.

## Dagger

Dagger is an execution engine for programmable delivery workflows. It is valuable when teams want CI/CD workflows written as code and backed by a container execution model.

Capsule is lower and narrower: it defines runtime action contracts that a workflow engine could call. It does not schedule pipelines, model DAGs, replace CI YAML, or provide a workflow graph.

## Nitric And Encore

Nitric and Encore are application frameworks with infrastructure-aware development models. They help developers describe services, APIs, resources, and environments as part of the application architecture.

Capsule is deliberately not an application framework. It should be usable inside a Nitric app, Encore app, CI runner, agent harness, local CLI, or deployment platform without forcing that system to adopt Capsule as the app model.

## Terraform And Pulumi

Terraform and Pulumi manage desired infrastructure state. They are responsible for planning, applying, tracking, updating, and destroying long-lived resources against cloud APIs.

Capsule should not duplicate that. Capsule's receipts are observational records of runtime actions. They are useful audit evidence, but they are not a state database and they do not replace drift detection, plan/apply, imported resource management, or provider schemas.

The practical boundary:

- Use Terraform/Pulumi when the question is "what infrastructure should exist?"
- Use Capsule when the question is "what runtime action did this agent/tool/CI system request, with which provider capability and policy decision?"

## Vercel And Cloudflare

Vercel and Cloudflare expose provider APIs and SDKs for their own platforms. Capsule should not hide the fact that a Vercel deployment and a Cloudflare Worker differ in routing, bindings, runtime APIs, build/upload flow, and logs.

Capsule's value is the common evidence/control layer around those actions:

- the action was `edge.deploy`;
- the adapter was `vercel` or `cloudflare`;
- the support level was declared;
- policy was evaluated;
- receipt metadata captured the provider resource;
- raw provider access remained available for platform-specific needs.

That is a smaller claim than "write once, deploy everywhere", and it is the correct claim for Capsule.

