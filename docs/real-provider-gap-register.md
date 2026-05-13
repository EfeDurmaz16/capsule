# Real Provider Gap Register

Capsule now has real adapters for Docker, E2B, Daytona, Modal, Neon, Cloudflare Workers, Cloud Run, Vercel, Kubernetes, Lambda, ECS/Fargate, EC2, Fly Machines, and Azure Container Apps. The mock adapter remains valuable for contract examples, but no original provider family is represented only by mocks.

## Remaining Mock/Planned Providers

No original provider family is currently represented only by mocks. Remaining work is lifecycle depth, live tests, and optional provider families.

## Rule For Removing A Mock Gap

A provider leaves this register only when:

1. A real package exists under `packages/adapter-*`.
2. It authenticates against the real provider API or official SDK.
3. Tests cover request mapping without live credentials.
4. Receipts include provider, capability path, support level, resource IDs, and policy notes.
5. Docs and provider matrix mark exactly which features are real, unsupported, emulated, or experimental.
6. CLI/examples either support the adapter or explicitly explain why they do not.

## Near-Term Order

1. Add deeper lifecycle operations to existing real adapters: logs, status polling, cancel/delete, rollback, route/alias management, and teardown.
2. Add optional live-provider smoke tests gated by provider credentials and `CAPSULE_LIVE_TESTS=1`.
3. Add provider contract test suites that adapter authors can run against fake clients and optional live credentials.
