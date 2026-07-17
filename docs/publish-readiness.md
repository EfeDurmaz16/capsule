# Publish Readiness

Capsule packages are not published to npm yet. Do not add npm version badges before the first successful publication.

Run the release audit before publishing:

```bash
pnpm build
pnpm release:audit
```

`pnpm release:audit` performs:

1. package metadata audit for every public `@capsule-sdk/*` package;
2. unfinished marker gate over shipped source;
3. `pnpm pack` dry run for every public package;
4. install smoke in a temporary fixture using the packed tarballs;
5. package-name import smoke for every packed package;
6. `@capsule-sdk/cli` bin smoke through `pnpm exec capsule capabilities`.

## Npm Ownership Checks

Before the first publish, verify these manually with the npm account that will publish Capsule:

1. The npm organization `@capsule` exists or is intentionally unavailable and a final namespace decision has been made.
2. The publishing account has owner or maintainer permission for the `@capsule` organization.
3. Every intended public package name is available under the chosen namespace:
   - `@capsule-sdk/core`
   - `@capsule-sdk/docker`
   - `@capsule-sdk/mock`
   - `@capsule-sdk/e2b`
   - `@capsule-sdk/daytona`
   - `@capsule-sdk/modal`
   - `@capsule-sdk/cloud-run`
   - `@capsule-sdk/cloudflare`
   - `@capsule-sdk/vercel`
   - `@capsule-sdk/neon`
   - `@capsule-sdk/kubernetes`
   - `@capsule-sdk/lambda`
   - `@capsule-sdk/ecs`
   - `@capsule-sdk/ec2`
   - `@capsule-sdk/fly`
   - `@capsule-sdk/azure`
   - `@capsule-sdk/ai`
   - `@capsule-sdk/cli`
   - `@capsule-sdk/preview`
   - `@capsule-sdk/store-jsonl`
   - `@capsule-sdk/store-sqlite`
4. Two-factor authentication and npm provenance requirements match the release workflow.
5. `NPM_TOKEN` is an automation token scoped to the organization/packages and stored only in GitHub Actions secrets.
6. The first release PR from Changesets is reviewed before publishing.

After publication, update README badges and install text to reflect actual npm availability.
