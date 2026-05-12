# Provider Matrix

Status legend:

- `real`: implemented against a real provider/runtime API in this repo.
- `mock`: modeled by `@capsule/adapter-mock` for tests/examples only.
- `planned`: documented target with no real adapter yet.

| Provider | Adapter status | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker | real | native | native | unsupported | unsupported | unsupported | unsupported | unsupported | Local Docker is useful but not safe for hostile code by default. Sandbox port exposure is supported through local-only `127.0.0.1` Docker publish flags unless a caller explicitly opts into another bind IP. Sandbox snapshot/restore are unsupported because Capsule exposes no public restore API or portable Docker restore semantics today. |
| Neon | real | unsupported | unsupported | unsupported | unsupported | native | unsupported | unsupported | Database branch create/delete and connection URI retrieval are implemented; preview orchestration remains unsupported. |
| E2B | real | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Cloud sandbox create, exec, file read/write/list, and destroy are implemented through the E2B SDK. |
| Daytona | real | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox create, exec, file read/write/list, and delete are implemented through the Daytona SDK; job and preview wrappers are unsupported until implemented. |
| Modal | real | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox create, exec, file read/write, and terminate are implemented through the Modal JS SDK; file listing and broader function/service workflows are unsupported. |
| Cloudflare Workers | real | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported | Worker module upload is implemented; routes, secrets, logs, versions, and rollback remain explicit future capabilities. |
| Cloud Run | real | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | Cloud Run Jobs and Services are implemented via Admin API v2; logs/IAM/public access and preview orchestration are not faked. |
| Vercel | real | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported | Inline deployment creation is implemented; service/preview wrappers, large file upload/SHA flow, aliases, env, logs, and rollback remain explicit future capabilities. |
| Kubernetes | real | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | Jobs, Deployments, and Services are implemented through the official Kubernetes client; sandbox/machine wrappers, logs/ingress/rollout are explicit future work. |
| Lambda | real | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported | Existing Lambda function invocation is implemented as `job.run`; function deployment/env mutation is not faked. |
| ECS/Fargate | real | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | RunTask and CreateService are implemented for existing task definitions; task-definition registration, previews, and load balancers are future work. |
| EC2 | real | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | native | `machine.create` is implemented through RunInstances; job/service wrappers and exec/start/stop/snapshot remain explicit future work. |
| Daytona | real | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Workspace-oriented sandbox model implemented by `@capsule/adapter-daytona`; jobs/previews are unsupported until public wrappers exist. |
| Modal | real | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox primitive implemented by `@capsule/adapter-modal`; broader functions/services are future work. |
| Cloudflare Sandbox | mock/planned | experimental | experimental | experimental | native | experimental | experimental | unsupported | Bindings and runtime semantics matter. |
| Microsandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-focused future adapter target. |
| Cloud Run Jobs | real | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported | Job primitive implemented by `@capsule/adapter-cloud-run`; preview orchestration is unsupported. |
| Cloud Run Services | real | unsupported | unsupported | native | unsupported | unsupported | unsupported | unsupported | Service primitive implemented by `@capsule/adapter-cloud-run`; preview orchestration is unsupported. |
| ECS/Fargate | real | unsupported | native | native | unsupported | unsupported | unsupported | unsupported | Existing task definitions are run/deployed by `@capsule/adapter-ecs`; previews are unsupported. |
| Kubernetes Jobs | real | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported | Job primitive implemented by `@capsule/adapter-kubernetes`; cluster policy varies. |
| Kubernetes Deployments | real | unsupported | unsupported | native | unsupported | unsupported | unsupported | unsupported | Deployment and Service creation implemented by `@capsule/adapter-kubernetes`. |
| Lambda | real | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported | Existing function invoke is implemented by `@capsule/adapter-lambda`; edge deploy remains future work. |
| Vercel | real | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported | Edge/deployment primitive implemented by `@capsule/adapter-vercel`; routes, aliases, services, and previews are future work. |
| Cloudflare Workers | mock/planned | unsupported | experimental | experimental | native | experimental | experimental | unsupported | Broader bindings/resource lifecycle remains modeled in mocks until implemented by real adapters. |
| Cloudflare Containers | mock/planned | experimental | experimental | experimental | native | experimental | experimental | unsupported | Hybrid runtime model. |
| EC2 | real | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | native | Low-level machine creation is implemented by `@capsule/adapter-ec2`; job/service wrappers are unsupported. |
| Fly Machines | planned | experimental | native | native | unsupported | unsupported | experimental | experimental | Machine and app semantics overlap. |
| Azure Container Apps | planned | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Jobs and services fit. |
