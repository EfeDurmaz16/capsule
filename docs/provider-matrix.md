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
| Daytona | mock/planned | native | emulated | unsupported | unsupported | unsupported | experimental | unsupported | Workspace-oriented sandbox model. |
| Modal | mock/planned | native | native | experimental | unsupported | unsupported | experimental | unsupported | Strong function and sandbox fit. |
| Cloudflare Sandbox | mock/planned | experimental | experimental | experimental | native | experimental | experimental | unsupported | Bindings and runtime semantics matter. |
| Microsandbox | planned | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-focused future adapter target. |
| Cloud Run Jobs | mock/planned | unsupported | native | unsupported | unsupported | unsupported | experimental | unsupported | Job primitive. |
| Cloud Run Services | mock/planned | unsupported | unsupported | native | unsupported | unsupported | experimental | unsupported | Service primitive. |
| ECS/Fargate | mock/planned | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Tasks and services map naturally. |
| Kubernetes Jobs | mock/planned | experimental | native | unsupported | unsupported | experimental | experimental | experimental | Cluster policy varies. |
| Kubernetes Deployments | mock/planned | experimental | unsupported | native | unsupported | experimental | experimental | experimental | Service deployment fit. |
| Lambda | mock/planned | unsupported | native | unsupported | experimental | unsupported | unsupported | unsupported | Function semantics differ from containers. |
| Vercel | mock/planned | unsupported | unsupported | experimental | native | unsupported | experimental | unsupported | Edge, deployments, routes, aliases. |
| Cloudflare Workers | mock/planned | unsupported | experimental | experimental | native | experimental | experimental | unsupported | Broader bindings/resource lifecycle remains modeled in mocks until implemented by real adapters. |
| Cloudflare Containers | mock/planned | experimental | experimental | experimental | native | experimental | experimental | unsupported | Hybrid runtime model. |
| EC2 | mock/planned | unsupported | emulated | emulated | unsupported | unsupported | unsupported | native | Low-level and leaky. |
| Fly Machines | planned | experimental | native | native | unsupported | unsupported | experimental | experimental | Machine and app semantics overlap. |
| Azure Container Apps | planned | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Jobs and services fit. |
