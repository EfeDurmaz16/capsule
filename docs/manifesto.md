# Capsule Manifesto

Agents increasingly execute code, deploy previews, create temporary databases, run checks, and touch cloud runtimes. Those actions need inspection, policy, and evidence.

The runtime landscape is fragmented. Docker, E2B, Daytona, Modal, Cloud Run, Lambda, ECS, Kubernetes, Vercel, Cloudflare, Neon, Fly Machines, Azure Container Apps, and EC2 expose different primitives. A fake universal abstraction hides the exact differences that matter most for correctness and safety.

Capsule chooses domain-aware primitives instead. Sandboxes, jobs, services, edge runtimes, database branches, preview environments, and machines each get explicit contracts. Providers can support a capability natively, emulate it, mark it experimental, or declare it unsupported.

Execution receipts matter because runtime actions need a durable record: what provider was used, what capability ran, what policy applied, what hashes were observed, what resource was created, and what Capsule actually saw.

Policy and evidence should be first-class. Capsule should make it hard for an agent or tool to silently cross network, filesystem, timeout, secret, TTL, or cost boundaries.

Capsule is not a new cloud. It is a small adapter and spec layer for existing runtimes.
