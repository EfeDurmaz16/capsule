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
