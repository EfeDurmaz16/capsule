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

The useful lesson from files-sdk is restraint:

- constructor-time adapter selection keeps call sites flat;
- provider packages remain separately importable;
- a local filesystem adapter works for dev and CI without becoming a production claim;
- provider-native escape hatches are treated as a feature, not a failure of the abstraction;
- agent tool factories can sit beside the SDK without forcing an AI framework into the core package.

The boundary that does not transfer cleanly is the operation model. Storage can expose one small common API because each provider ultimately stores keyed blobs. Runtime providers do not share a single unit. Capsule should therefore stay closer to files-sdk's adapter discipline than to a universal compute facade: `capsule.sandbox`, `capsule.job`, `capsule.edge`, `capsule.database`, `capsule.preview`, and `capsule.machine` are separate because their failure modes and evidence needs are separate.

Practical implication for Capsule:

- keep `@capsule/core` small and dependency-light;
- keep adapters as subpackages;
- keep `raw()` available for provider-native APIs;
- add AI helpers as optional framework adapters;
- do not pretend provider-specific deployment, rollback, route, secret, log, or database semantics are interchangeable.

## ComputeSDK

ComputeSDK is close to Capsule's sandbox slice. Its public README describes separate provider packages and a common sandbox interface for code execution, filesystem, and terminal-like capabilities.

Capsule should treat ComputeSDK as adjacent rather than obsolete. The difference is scope and evidence:

- ComputeSDK centers on running code in sandboxes.
- Capsule covers sandbox, job, service, edge, database/resource, preview, and machine domains.
- Capsule requires explicit capability support levels.
- Capsule makes policy decisions, logs, artifacts, and receipts part of the contract.

The risk for Capsule is overreach. The comparison with ComputeSDK is a reminder to keep the sandbox API small and avoid turning every provider detail into a fake common denominator.

ComputeSDK also has a provider routing model: applications configure one or more providers and can choose strategies such as priority or round-robin. Capsule should not copy routing blindly. Provider routing is useful when providers are substitutable for the same sandbox workflow. Capsule's broader domains need a stricter selection step first: a provider must satisfy the required capability paths for the workflow before any routing or fallback strategy is considered.

The sharper Capsule position:

- For "run code in a sandbox", ComputeSDK is a direct adjacent tool.
- For "run this agent action and keep a policy/receipt record", Capsule adds evidence.
- For "compose a preview from an edge deployment, service, database branch, and check job", Capsule covers domains outside ComputeSDK's sandbox center.
- For "choose between Cloudflare, Vercel, Neon, Docker, Fly, ECS, Kubernetes, Lambda, and EC2", Capsule should rank against domain requirements instead of treating providers as equivalent runtimes.

Capsule should interoperate with ComputeSDK where it makes sense. A future adapter could wrap ComputeSDK's sandbox provider interface for teams that already use it, while Capsule remains the policy, capability, and receipt layer around the action.

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

## Cloudflare, Vercel, And Neon

The reason to use Capsule instead of calling Cloudflare, Vercel, or Neon directly is not that Capsule knows those platforms better than their own SDKs. It does not. The reason is that a multi-provider agent, CI, or preview system needs one place to ask different questions:

- What domain is this action in: edge, service, job, database, preview, or machine?
- Is the requested capability native, emulated, experimental, or unsupported for this adapter?
- Which policy was evaluated before the provider call?
- What evidence did we collect afterward?
- Which provider-specific details were preserved rather than flattened away?

Direct provider SDK calls are better when the application is deeply tied to one platform and needs the full native API. Capsule is better when the caller is an agent framework, developer tool, CI system, deployment orchestrator, or preview controller that may touch several providers and needs consistent evidence around the action.

Cloudflare is the edge/runtime example. Its useful native concepts include Workers scripts, versions, routes, deployments, bindings, and rollback by Worker version. Capsule models that under `edge.*` while keeping unsupported features explicit. For example, Worker secret bindings and logs must not be silently faked as generic environment or log support.

Vercel is the web/edge deployment example. Its useful native concepts include deployments, URLs, projects, logs, release/alias flows, and platform-specific build behavior. Capsule should expose Vercel through edge/deployment receipts, not pretend it is the same thing as Cloudflare Workers or Cloud Run services.

Neon is the database/resource example. Its useful native concepts include projects, branches, parent branches, connection URIs, branch reset, and preview database lifecycle. Capsule should keep Neon under `database.*` and `preview` composition rather than calling it a service deployment.

The moat is the cross-provider control plane layer:

| Need | Direct provider SDK | Capsule |
| --- | --- | --- |
| Use every provider-native feature | Best fit | Use `raw()` or drop to provider SDK |
| Run one platform-specific app | Best fit | Extra layer may not be needed |
| Compare providers for a workflow | Manual docs/code | `providerCompatibilityScore`, recipe ranking, and capability paths |
| Enforce action policy before runtime calls | Caller-owned | First-class policy model and receipt notes |
| Record evidence across providers | Caller-owned | Normalized receipts with provider metadata |
| Compose preview resources across edge, service, job, and database | Multiple SDKs plus glue | Preview planning/orchestration layer |
| Let agents execute without hiding provider limits | Hard to standardize | Explicit support levels and unsupported errors |

Capsule's pitch should stay narrow: it is not a better Cloudflare SDK, Vercel SDK, or Neon SDK. It is the small TypeScript layer that lets tools use those SDKs through domain-aware contracts, policy decisions, capability negotiation, and receipts.
