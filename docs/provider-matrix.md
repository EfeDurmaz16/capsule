# Provider Matrix

| Provider | Sandbox | Job | Service | Edge/function | Database/resource | Preview | Machine | Support notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker | native | native | unsupported | unsupported | unsupported | unsupported | unsupported | Local Docker is useful but not safe for hostile code by default. |
| E2B | native | emulated | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-first provider. |
| Daytona | native | emulated | unsupported | unsupported | unsupported | experimental | unsupported | Workspace-oriented sandbox model. |
| Modal | native | native | experimental | unsupported | unsupported | experimental | unsupported | Strong function and sandbox fit. |
| Cloudflare Sandbox | experimental | experimental | experimental | native | experimental | experimental | unsupported | Bindings and runtime semantics matter. |
| Microsandbox | experimental | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | Sandbox-focused future adapter target. |
| Cloud Run Jobs | unsupported | native | unsupported | unsupported | unsupported | experimental | unsupported | Job primitive. |
| Cloud Run Services | unsupported | unsupported | native | unsupported | unsupported | experimental | unsupported | Service primitive. |
| ECS/Fargate | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Tasks and services map naturally. |
| Kubernetes Jobs | experimental | native | unsupported | unsupported | experimental | experimental | experimental | Cluster policy varies. |
| Kubernetes Deployments | experimental | unsupported | native | unsupported | experimental | experimental | experimental | Service deployment fit. |
| Lambda | unsupported | native | unsupported | experimental | unsupported | unsupported | unsupported | Function semantics differ from containers. |
| Vercel | unsupported | unsupported | experimental | native | unsupported | experimental | unsupported | Edge, deployments, routes, aliases. |
| Cloudflare Workers | unsupported | experimental | experimental | native | experimental | experimental | unsupported | Bindings are first-class. |
| Cloudflare Containers | experimental | experimental | experimental | native | experimental | experimental | unsupported | Hybrid runtime model. |
| Neon | unsupported | unsupported | unsupported | unsupported | native | experimental | unsupported | Database branch primitive. |
| EC2 | unsupported | emulated | emulated | unsupported | unsupported | unsupported | native | Low-level and leaky. |
| Fly Machines | experimental | native | native | unsupported | unsupported | experimental | experimental | Machine and app semantics overlap. |
| Azure Container Apps | unsupported | native | native | unsupported | unsupported | experimental | unsupported | Jobs and services fit. |
