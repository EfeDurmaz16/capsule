# Adding A Provider Adapter

Capsule adapters are small, explicit mappings from a provider service to one or more Capsule runtime domains. They are not generic HTTP clients and they are not portability promises.

Use this guide when adding a new package such as `@capsule/adapter-supabase`, `@capsule/adapter-railway`, or `@capsule/adapter-render`.

## 1. Classify The Provider Service

Start by asking which Capsule domain the provider service actually belongs to:

```bash
capsule classify provider cloudflare workers
capsule classify provider neon postgres
capsule classify provider fly mpg
```

The classifier does not claim adapter support. It gives a starting map:

- likely Capsule domains;
- likely capability paths;
- capabilities that should not be claimed;
- provider-specific caveats.

If no classification exists, add one to `@capsule/core` before claiming support in a new adapter. Unknown provider services should remain unclassified rather than guessed.

## 2. Scaffold The Package

Generate the first package shape:

```bash
capsule adapter scaffold supabase --domain database
capsule adapter scaffold railway --domain service
capsule adapter scaffold acme-cloud --domain sandbox --domain job
```

The scaffold creates:

```text
packages/adapter-<provider>/
  package.json
  tsconfig.json
  src/index.ts
  src/<provider>-adapter.ts
  src/<provider>.test.ts
```

Generated capabilities start as `unsupported`. This is deliberate. Moving a capability from `unsupported` to `experimental` or `native` requires request-mapping tests, receipt shape coverage, policy notes, docs, and optionally live tests.

Use `--out-dir` when testing the scaffold outside the workspace:

```bash
capsule adapter scaffold acme --domain edge --out-dir /tmp/capsule-adapters
```

Use `--force` only when intentionally replacing generated files.

## 3. Fill The Smallest Truthful Capability Map

Add only the domains the provider service owns.

Good:

```ts
export const railwayCapabilities: CapabilityMap = {
  service: {
    deploy: "experimental",
    update: "unsupported",
    delete: "experimental",
    status: "experimental",
    logs: "experimental",
    url: "experimental"
  }
};
```

Bad:

```ts
// Do not mark this native just because the provider has an API endpoint.
service: { deploy: "native" }
```

`native` means the provider exposes the capability directly and the adapter uses that API with tested semantics. `experimental` is the right first level for narrow or newly integrated provider behavior.

## 4. Implement One Domain First

Keep the first adapter PR narrow:

- one provider package;
- one domain;
- one or two operations;
- fake-client tests;
- receipt shape tests;
- policy notes;
- live test gate if credentials are available.

Do not add dashboards, auth, servers, databases, queues, or provider provisioning workflows inside the adapter package.

## 5. Add Tests

Every adapter should run the shared contract suite:

```ts
import { runCapsuleAdapterContract } from "@capsule/core";
import { railway } from "./index.js";

test("runs the shared adapter contract suite", async () => {
  await runCapsuleAdapterContract(railway({ fakeClient: true }), {
    domains: ["service"]
  });
});
```

Request-mapping tests should use a fake fetch/client and assert:

- endpoint;
- method;
- request body;
- headers without leaking secrets;
- response mapping;
- error mapping;
- receipt fields;
- policy notes.

Live tests must be skipped by default:

```ts
liveTest(
  test,
  "deploys a service",
  liveTestGate({
    provider: "railway",
    credentials: ["RAILWAY_TOKEN", "CAPSULE_RAILWAY_PROJECT_ID"]
  }),
  async () => {
    // real provider call
  }
);
```

Never run provider-live tests in routine CI without dedicated test accounts, quotas, and cleanup monitoring.

## 6. Document Credential And Cleanup Boundaries

Docs should name environment variables, never values:

```text
RAILWAY_TOKEN
CAPSULE_RAILWAY_PROJECT_ID
```

Docs should also say what cleanup does and does not guarantee. Receipts are observational records of what Capsule requested and observed. They are not full provider audit logs.

## 7. Keep Provider-Specific Escape Hatches

Expose provider-specific clients or metadata through `raw()` or typed `providerOptions` when needed. That is better than distorting the common Capsule domain model.

Examples:

- Cloudflare rollback needs `providerOptions.scriptName`.
- Vercel alias release is not the same as Cloudflare Worker deployment rollback.
- Neon branch reset is a database/resource operation, not a service deployment.

## Adapter Review Checklist

- [ ] Provider service is classified by domain.
- [ ] Capability map is explicit and conservative.
- [ ] Unsupported capabilities throw instead of silently emulating.
- [ ] Policy evaluation runs before provider actions that accept env, secrets, timeouts, resources, TTL, or cost-sensitive inputs.
- [ ] Receipts include provider, adapter, capability path, support level, resource metadata, and policy decision.
- [ ] Errors and receipts do not include tokens, private keys, signed URLs, connection strings, or raw secrets.
- [ ] Fake-client tests cover request mapping.
- [ ] Shared contract tests pass.
- [ ] Optional live tests are gated behind `CAPSULE_LIVE_TESTS=1`.
- [ ] Docs explain provider-specific limitations.
