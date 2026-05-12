# Real Provider Gap Register

Capsule now has real adapters for Docker, E2B, Neon, Cloudflare Workers, Cloud Run, and Vercel. The mock adapter remains valuable for contract examples, but these providers still need real adapter packages before the repository can honestly claim there are no mock-only provider paths.

## Remaining Mock/Planned Providers

| Provider | Target package | First real primitive | Required provider config | Notes |
| --- | --- | --- | --- | --- |
| Modal | `@capsule/adapter-modal` | `sandbox.create`, `job.run` | Modal token/profile or SDK config | Prefer official SDK if TypeScript support covers sandbox/function lifecycle. |
| Daytona | `@capsule/adapter-daytona` | `sandbox.create`, workspace exec/files | Daytona API key, organization/project/workspace defaults | Workspace semantics are close to sandbox but long-lived enough to document honestly. |
| ECS/Fargate | `@capsule/adapter-ecs` | `job.run`, service deploy later | AWS region, cluster, task definition, subnets, security groups | Needs adapter options because Capsule's generic `RunJobSpec` cannot infer networking. |
| EC2 | `@capsule/adapter-ec2` | `machine.create` | AWS region, AMI, subnet/security group/key/role | Lower-level primitive; do not hide SSH/IAM/network leakage. |
| Fly Machines | `@capsule/adapter-fly` | `machine.create`, `job.run` | Fly token, org/app/region | Machines overlap with service/job; capability map must distinguish one-shot machine runs. |
| Azure Container Apps | `@capsule/adapter-azure-container-apps` | `job.run`, `service.deploy` | Azure tenant/subscription/resource group/environment | Use Azure identity/client libraries only where auth complexity justifies it. |

## Rule For Removing A Mock Gap

A provider leaves this register only when:

1. A real package exists under `packages/adapter-*`.
2. It authenticates against the real provider API or official SDK.
3. Tests cover request mapping without live credentials.
4. Receipts include provider, capability path, support level, resource IDs, and policy notes.
5. Docs and provider matrix mark exactly which features are real, unsupported, emulated, or experimental.
6. CLI/examples either support the adapter or explicitly explain why they do not.

## Near-Term Order

1. Kubernetes jobs/services, because the primitives are standard and contract-testable locally with fake clients.
2. Lambda invoke, because AWS SDK v3 gives correct signing and the job/function model is narrow.
3. ECS/Fargate tasks, because it shares AWS auth but needs more network config.
4. Modal and Daytona, after current SDK/API shape is verified.
5. EC2/Fly/Azure, after machine lifecycle contracts are expanded beyond create-only.
