# Provider Matrix

Status legend:

- `real`: implemented against a real provider/runtime API in this repo.
- `mock`: modeled by `@capsule/adapter-mock` for tests/examples only.
- `planned`: documented target with no real adapter yet.

| Provider | Adapter status | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker | real | native | native | unsupported | unsupported | unsupported | unsupported | unsupported | Local Docker is useful but not safe for hostile code by default. |
| Neon | real | unsupported | unsupported | unsupported | unsupported | native | experimental | unsupported | Database branch create/delete and connection URI retrieval are implemented. |
| E2B | real | native | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Cloud sandbox create, exec, file read/write/list, and destroy are implemented through the E2B SDK. |
| Cloudflare Workers | real | unsupported | unsupported | unsupported | native | unsupported | unsupported | unsupported | Worker module upload is implemented; routes, secrets, logs, versions, and rollback remain explicit future capabilities. |
| Cloud Run | real | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Cloud Run Jobs and Services are implemented via Admin API v2; logs/IAM/public access are not faked. |
| Vercel | real | unsupported | unsupported | experimental | native | unsupported | experimental | unsupported | Inline deployment creation is implemented; large file upload/SHA flow, aliases, env, logs, and rollback remain explicit future capabilities. |
| Kubernetes | real | experimental | native | native | unsupported | unsupported | experimental | experimental | Jobs, Deployments, and Services are implemented through the official Kubernetes client; logs/ingress/rollout are explicit future work. |
| Lambda | real | unsupported | native | unsupported | unsupported | unsupported | unsupported | unsupported | Existing Lambda function invocation is implemented as `job.run`; function deployment/env mutation is not faked. |
| Daytona | mock/planned | native | emulated | unsupported | unsupported | unsupported | experimental | unsupported | Workspace-oriented sandbox model. |
| Modal | mock/planned | native | native | experimental | unsupported | unsupported | experimental | unsupported | Strong function and sandbox fit. |
| Cloudflare Sandbox | mock/planned | experimental | experimental | experimental | native | experimental | experimental | unsupported | Bindings and runtime semantics matter. |
| Microsandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-focused future adapter target. |
| Cloud Run Jobs | real | unsupported | native | unsupported | unsupported | unsupported | experimental | unsupported | Job primitive implemented by `@capsule/adapter-cloud-run`. |
| Cloud Run Services | real | unsupported | unsupported | native | unsupported | unsupported | experimental | unsupported | Service primitive implemented by `@capsule/adapter-cloud-run`. |
| ECS/Fargate | mock/planned | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Tasks and services map naturally. |
| Kubernetes Jobs | real | experimental | native | unsupported | unsupported | unsupported | experimental | experimental | Job primitive implemented by `@capsule/adapter-kubernetes`; cluster policy varies. |
| Kubernetes Deployments | real | experimental | unsupported | native | unsupported | unsupported | experimental | experimental | Deployment and Service creation implemented by `@capsule/adapter-kubernetes`. |
| Lambda | real | unsupported | native | unsupported | experimental | unsupported | unsupported | unsupported | Existing function invoke is implemented by `@capsule/adapter-lambda`; edge deploy remains future work. |
| Vercel | real | unsupported | unsupported | experimental | native | unsupported | experimental | unsupported | Edge/deployment primitive implemented by `@capsule/adapter-vercel`; routes and aliases are future work. |
| Cloudflare Workers | mock/planned | unsupported | experimental | experimental | native | experimental | experimental | unsupported | Broader bindings/resource lifecycle remains modeled in mocks until implemented by real adapters. |
| Cloudflare Containers | mock/planned | experimental | experimental | experimental | native | experimental | experimental | unsupported | Hybrid runtime model. |
| EC2 | mock/planned | unsupported | emulated | emulated | unsupported | unsupported | unsupported | native | Low-level and leaky. |
| Fly Machines | planned | experimental | native | native | unsupported | unsupported | experimental | experimental | Machine and app semantics overlap. |
| Azure Container Apps | planned | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Jobs and services fit. |
