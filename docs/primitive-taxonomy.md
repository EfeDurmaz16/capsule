# Primitive Taxonomy

## Sandbox

A sandbox is an isolated workspace for agent or user-generated code execution. It supports create, exec, file operations, logs, artifacts, snapshots, port exposure, and destruction. Provider-specific risks include isolation strength, networking, persistence, and filesystem semantics.

## Job Or Function

A job is finite-duration compute. It includes one-off containers, Cloud Run Jobs, ECS tasks, Kubernetes Jobs, Lambda invocations, Modal functions, and Fly Machines one-shot execution. Jobs are good for checks, builds, migrations, and batch work.

## Service Deployment

A service is long-running HTTP or TCP compute. Cloud Run Services, ECS/Fargate Services, Kubernetes Deployments, Azure Container Apps, and Fly Apps fit here. Services need health checks, URLs, scaling, rollback, env, and logs.

## Edge Runtime

Edge runtimes include Vercel deployments/functions, Cloudflare Workers/Pages/Containers, Lambda-style functions, routes, bindings, versions, and releases. They are separate from services because deployment, routing, global distribution, and platform bindings are different.

## Database Or Resource

Database/resource primitives model managed deployment-adjacent resources such as Neon branches, D1 databases, KV namespaces, R2 buckets, and future Supabase or PlanetScale branches. They need connection strings, branch lifecycle, migrations, snapshots, and receipts.

## Preview Environment

A preview environment composes services, edge runtimes, database branches, jobs, URLs, logs, artifacts, TTL policy, and cleanup. It is orchestration, not a single provider object.

## Machine Or VM

Machines expose lower-level VM or bare-metal control: create, exec, start, stop, snapshot, volumes, and networking. EC2, GCE, Azure VM, bare metal, Nomad, and Firecracker belong here. This primitive is powerful but leaks provider details heavily.
