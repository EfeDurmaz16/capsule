# Preview Environments

A preview environment is a composition primitive.

Typical flow:

1. Create a database branch.
2. Deploy a web service or edge runtime.
3. Deploy an API service.
4. Run checks or jobs.
5. Collect logs and artifacts.
6. Return URLs.
7. Enforce TTL, cost, and resource policy.
8. Cleanup.
9. Produce a preview receipt.

Capsule should let providers and framework maintainers model their preview orchestration honestly. Some providers expose previews natively; others require composition across multiple domains.

`@capsule/preview` is the composition package for the second case. It accepts explicit `Capsule` instances per resource, so an environment can combine a Neon branch, a Cloud Run service, a Cloudflare Worker, and a smoke-test job without pretending they share one provider model.

The package records a resource graph containing service, edge, database, and job resources. Cleanup walks that graph in reverse dependency order and reports partial cleanup failures instead of hiding successfully cleaned resources.

`createPreviewEnvironmentWithCleanup(...)` attempts cleanup when creation fails after earlier resources were provisioned. Receipts from the underlying domain operations remain the evidence source; preview orchestration does not claim provider-native preview support unless an adapter exposes it.
