# Provider Matrix

Status legend:

- `real`: implemented against a real provider/runtime API in this repo.
- `mock`: modeled by `@capsule/adapter-mock` for tests/examples only.
- `planned`: documented target with no real adapter yet.

## Real Adapters

| Provider | Package | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker | `@capsule/adapter-docker` | native | native | unsupported | unsupported | unsupported | unsupported | unsupported | Local Docker is useful but not safe for hostile code by default. Sandbox port exposure is supported through local-only `127.0.0.1` Docker publish flags unless a caller explicitly opts into another bind IP. Sandbox snapshot/restore are unsupported because Capsule exposes no public restore API or portable Docker restore semantics today. |
| E2B | `@capsule/adapter-e2b` | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Cloud sandbox create, exec, file read/write/list, and destroy are implemented through the E2B SDK. |
| Daytona | `@capsule/adapter-daytona` | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox create, exec, file read/write/list, and delete are implemented through the Daytona SDK; job and preview wrappers are unsupported until implemented. |
| Modal | `@capsule/adapter-modal` | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox create, exec, file read/write, and terminate are implemented through the Modal JS SDK; file listing and broader function/service workflows are unsupported. |
| Cloud Run | `@capsule/adapter-cloud-run` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | Cloud Run Jobs and Services are implemented via Admin API v2; logs/IAM/public access and preview orchestration are not faked. |
| Cloudflare Workers | `@capsule/adapter-cloudflare` | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported | Worker module upload is implemented; routes, secrets, logs, versions, and rollback remain explicit future capabilities. |
| Vercel | `@capsule/adapter-vercel` | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported | Inline deployment creation is implemented; service/preview wrappers, large file upload/SHA flow, aliases, env, logs, and rollback remain explicit future capabilities. |
| Neon | `@capsule/adapter-neon` | unsupported | unsupported | unsupported | unsupported | native | unsupported | unsupported | Database branch create/delete/reset and connection URI retrieval are implemented; migrations and preview orchestration remain unsupported. |
| Kubernetes | `@capsule/adapter-kubernetes` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | Jobs, Deployments, Services, and selector-based combined Pod logs are implemented through the official Kubernetes client; follow streaming is rejected, and sandbox/machine wrappers, ingress, and rollout remain explicit future work. |
| Lambda | `@capsule/adapter-lambda` | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported | Existing Lambda function invocation is implemented as `job.run`; function deployment/env mutation is not faked. |
| ECS/Fargate | `@capsule/adapter-ecs` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | RunTask and CreateService are implemented for existing task definitions; task-definition registration, previews, and load balancers are future work. |
| EC2 | `@capsule/adapter-ec2` | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | native | `machine.create/status/start/stop/destroy` are implemented through EC2 APIs; job/service wrappers, exec, and snapshot remain explicit future work. |
| Fly Machines | `@capsule/adapter-fly` | unsupported | native | unsupported | unsupported | unsupported | unsupported | native | Fly Machines API supports machine create/status/start/stop/destroy and one-shot job machines; services, logs, volumes, and app networking remain explicit future work. |
| Azure Container Apps | `@capsule/adapter-azure-container-apps` | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | ARM APIs support Container App service create/update and manual job create/start; logs, revisions, secrets, registries, and delete/status lifecycle remain explicit future work. |

## Mock And Planned Modeling

| Provider/model | Adapter status | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mock provider models | mock | varies | varies | varies | varies | varies | varies | varies | `@capsule/adapter-mock` provides fake E2B, Daytona, Modal, Cloud Run, Vercel, Cloudflare, Neon, Lambda, ECS, Kubernetes, and EC2 capability models for tests/examples only. It returns fake objects and does not call real provider APIs. |
| Cloudflare Sandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Future sandbox-focused adapter target; not implemented as a real provider adapter in this repo yet. |
| Cloudflare Containers | planned | unsupported | experimental | experimental | experimental | unsupported | experimental | unsupported | Hybrid runtime model still needs a real adapter and provider-specific lifecycle design. |
| Microsandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-focused future adapter target. |
