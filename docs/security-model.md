# Security Model

Capsule is not a sandbox by itself.

Isolation depends on the provider and the adapter. Docker local is not safe for hostile untrusted code unless configured carefully with host hardening, container isolation, seccomp/AppArmor, user namespaces, network controls, filesystem controls, and resource limits outside the basic adapter path.

Policy support may be native, emulated, unsupported, experimental, delegated to a provider, or best-effort. Capsule records policy decisions and notes, but it must not claim full enforcement when enforcement is delegated, partial, or missing.

Docker `network.mode = "none"` is applied with Docker's `--network none` where the Docker adapter controls container creation. Docker host allowlists are not natively enforced by the adapter and are recorded as unsupported/best-effort. Cloud-provider resource, network, CPU, memory, secret, cost, and TTL policies are delegated to provider APIs only where those APIs expose the relevant controls.

Receipts are observational records. They record what Capsule requested and observed, including hashes and resource metadata. They are not a cryptographic proof of the entire provider environment unless future signing and provider attestations are added.

Mock adapters are marked as mocks in two places: `adapter.raw()` returns `{ mock: true }`, and mock-generated receipts include `metadata.mock: true` with the mock provider and adapter names. Production preview orchestration should require real providers so mock success cannot satisfy a live preview run by accident.

Secrets must be handled carefully. Avoid logging raw credentials, private keys, tokens, connection strings, or payment data. Use allowlists and redaction. Provider docs and runtime isolation guarantees still matter.

## Observation vs Attestation

Capsule receipts prove what Capsule observed at the adapter boundary:

- the requested capability path
- the adapter/provider name
- policy decision and notes
- command/source/resource metadata supplied to Capsule
- stdout/stderr hashes when Capsule receives output
- resource IDs and URLs returned by provider APIs

They do not prove the full state of the provider runtime, host kernel, cloud control plane, network path, IAM policy, base image, or workload filesystem. A signed Capsule receipt would only sign Capsule's observation unless it is explicitly combined with provider attestations, workload signatures, image provenance, or confidential-computing evidence.

## Provider Caveats

### Docker

Docker is a local runtime adapter, not a hostile-code security boundary by default. `--network none` can remove container networking for containers Capsule creates, but it does not automatically protect the host Docker daemon, mounted paths, privileged container settings, kernel attack surface, shared caches, or secrets already present on the host.

Use Docker for trusted developer workflows, CI jobs with hardened runners, and local examples. For hostile user-generated code, prefer a provider/runtime designed for that threat model and still verify its isolation model.

### E2B

E2B isolation is provided by the E2B cloud sandbox service. Capsule can request sandbox creation, file operations, command execution, and network policy options, then record the resulting receipt. Capsule does not independently attest the VM/container internals, base template contents, or E2B control-plane behavior.

Treat filesystem policy as adapter-boundary behavior unless the provider exposes native controls for the exact operation.

### Daytona

Daytona workspaces are useful for developer-environment style sandboxes. Workspace lifecycle, persistence, target selection, auto-stop, networking, and image semantics are Daytona-specific. Capsule can make the lifecycle explicit, but it should not claim Daytona workspaces are equivalent to E2B, Modal, Docker, or microVM isolation.

### Modal

Modal sandboxes inherit Modal's runtime isolation, image, secret, environment, and networking semantics. Capsule's current Modal adapter focuses on sandbox create/exec/file/write/destroy behavior. It does not model broader Modal function permissions, app-level deployment policy, or provider-side secret scopes as a generic Capsule guarantee.

### Kubernetes

Kubernetes security depends heavily on the cluster:

- namespace boundaries
- service accounts and RBAC
- admission controllers
- Pod Security admission
- NetworkPolicy enforcement
- node isolation
- image pull policy and registry trust
- volume mounts
- runtime class and container runtime configuration

Capsule can submit Jobs, Deployments, and Services through the Kubernetes API, but the cluster decides whether those objects are safe. Do not treat Kubernetes `namespace` separation as equivalent to sandbox isolation for hostile code.

### Cloud Jobs

Cloud Run Jobs, ECS/Fargate tasks, Lambda invocation, Azure Container Apps jobs, and Fly one-shot machines all have provider-specific isolation, IAM, networking, logging, and cost semantics.

Capsule can normalize a `job.run` request and receipt, but it does not hide:

- IAM role/service account permissions
- VPC/subnet/security-group egress
- container image provenance
- function/task environment variables
- provider log retention
- retry behavior and duplicate execution
- regional data placement
- billing and quota limits

Timeouts and resource controls are native only when the provider exposes an API that Capsule actually uses.

### Edge Runtimes

Vercel and Cloudflare Workers are not generic containers. Routes, aliases, domains, bindings, environment variables, project settings, previews, and rollback semantics are part of the security model.

Capsule records deployment receipts for what it created, but it does not currently prove that a route is the only active route, that an alias points to a specific version forever, or that platform-level environment variables and bindings were unchanged outside Capsule.

### Database Branches

Neon database branches and future database/resource adapters are deployment-adjacent resources. Their security properties depend on:

- project permissions
- branch parent selection
- connection string handling
- role/database privileges
- migration behavior
- provider backups and retention
- cleanup and TTL enforcement

Connection strings are secrets. Receipts should include resource IDs and policy notes, not raw connection strings unless an adapter contract explicitly permits it and the caller accepts the risk.

### Machines

Machines and VMs are the leakiest Capsule primitive. EC2, Fly Machines, and future VM adapters expose real infrastructure concerns:

- AMI/image trust
- SSH/SSM access
- instance profiles and IAM
- security groups/firewalls
- volumes and snapshots
- public IPs
- user data
- patching and long-lived drift
- stop vs terminate billing behavior

Capsule should make those details visible rather than pretending a machine is just a bigger sandbox.

## Secrets Guidance

Use these rules for adapters, examples, and applications built on Capsule:

1. Pass provider credentials through adapter options or environment variables, never through command strings.
2. Keep `policy.secrets.allowed` narrow. If a secrets policy exists, Capsule denies env keys outside the allowlist.
3. Enable `policy.secrets.redactFromLogs` when command output may include credentials, tokens, or connection strings.
4. Do not print full receipts blindly in production if metadata may contain sensitive provider fields.
5. Do not include raw provider tokens in `metadata`, `resource`, errors, or logs.
6. Treat database connection strings, webhook secrets, private keys, AWS keys, OAuth tokens, and session cookies as secrets.
7. Prefer provider-native secret stores for deployed services and edge runtimes; use Capsule env passing only when the adapter and provider semantics are clear.
8. Rotate credentials used for live tests and keep `CAPSULE_LIVE_TESTS=1` out of default CI.

## Default Deny Posture

If a capability is unsupported, Capsule should throw `UnsupportedCapabilityError`. If policy denies a request, Capsule should throw `PolicyViolationError`. If enforcement is emulated, delegated, partial, or unsupported, the receipt notes should say so directly.

Security-sensitive adapters should fail closed when required identity, project, region, namespace, or network configuration is missing.
