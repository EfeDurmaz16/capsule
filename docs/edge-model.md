# Edge Model

Edge deployment is separate from service deployment because global runtime platforms expose different concerns.

Vercel centers on deployments, functions, routes, builds, aliases, releases, and framework integration. Cloudflare centers on Workers, Pages, bindings, routes, Durable Objects, KV, R2, D1, and Containers. Lambda can behave like job/function execution or edge-adjacent function deployment depending on API Gateway, Lambda@Edge, or routing setup.

Capsule models edge deploy, version creation, release, rollback, routes, env, bindings, logs, URL discovery, and receipts. Provider-specific escape hatches are expected.
