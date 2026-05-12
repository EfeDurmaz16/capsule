# Edge Model

Edge deployment is separate from service deployment because global runtime platforms expose different concerns.

Vercel centers on deployments, functions, routes, builds, aliases, releases, and framework integration. Cloudflare centers on Workers, Pages, bindings, routes, Durable Objects, KV, R2, D1, and Containers. Lambda can behave like job/function execution or edge-adjacent function deployment depending on API Gateway, Lambda@Edge, or routing setup.

Capsule models edge deploy, version creation, release, rollback, routes, env, bindings, logs, URL discovery, and receipts. Provider-specific escape hatches are expected.

The real Cloudflare adapter currently implements the smallest honest subset: upload a Worker module with multipart metadata to the Cloudflare Workers Scripts API. `edge.deploy` can create or update the script, record requested routes in the receipt, and optionally return a workers.dev URL when configured with a known workers.dev subdomain. It does not mutate routes, create secrets, provision KV/R2/D1/Durable Objects, read logs, manage traffic-split deployments, or rollback versions.
