# Deployment Model

Capsule separates deployment domains instead of flattening them.

Jobs cover finite work: Cloud Run Jobs, ECS tasks, Kubernetes Jobs, Lambda, Modal functions, Docker one-off containers, and Azure Container Apps Jobs.

Services cover long-running HTTP or TCP workloads: Cloud Run Services, ECS/Fargate Services, Kubernetes Deployments and Services, Azure Container Apps, Fly Apps, Railway, Render, and Docker Compose-style local dev.

Edge and functions cover Vercel, Cloudflare Workers, Cloudflare Pages, Lambda, Netlify-style functions, and platform-specific routing or bindings.

Database branches and managed resources cover Neon, Cloudflare D1/KV/R2, Supabase branching, and PlanetScale-style branching. Neon is a database/resource primitive, not a service.

Machines cover EC2, Compute Engine, Azure VM, bare metal, Firecracker, Nomad, and Fly Machines lower-level control. EC2 is lower-level because networking, images, volumes, security groups, SSH, and lifecycle semantics leak through.

Cloud Run, ECS, and Kubernetes overlap naturally for jobs and services. Vercel and Cloudflare need edge-specific primitives because routing, deployment release models, bindings, and platform runtimes are first-class.

The real Cloud Run adapter uses the Cloud Run Admin API v2 for Jobs and Services. It creates and runs jobs, maps execution `completionStatus` from the Execution API for `job.status`, sends execution `:cancel` for `job.cancel`, creates services from container images, waits for long-running operations when configured, and records receipts. Cloud Run execution deletion is intentionally separate from cancel: deleting an execution removes the execution resource/list entry and is exposed only through the provider client helper, not as generic `job.cancel`. The adapter does not fake stdout/stderr from Cloud Logging, mutate IAM to make services public, or deploy from source through Cloud Build.

The real Kubernetes adapter uses the official Kubernetes JavaScript client. It creates Jobs for `job.run` and creates a Deployment plus Service for `service.deploy`. It records Kubernetes resource IDs and in-cluster DNS names, but it does not claim rollout completion, ingress exposure, log collection, RBAC enforcement, or runtime isolation beyond what the target cluster actually provides.

The real Lambda adapter maps `job.run` to invoking an existing Lambda function through AWS SDK v3. It is intentionally not a function deployment adapter yet: Capsule passes command/env/image metadata as event payload and records the invoke response, but it does not update function code, mutate Lambda environment variables, or provision API Gateway/Lambda@Edge.

The real ECS adapter maps `job.run` to `RunTask` and `service.deploy` to `CreateService` through AWS SDK v3. It requires an existing task definition and explicit cluster/container/network options. Capsule records the intended image but does not register task definitions, create load balancers, provision IAM roles, or configure CloudWatch Logs in the first adapter.
