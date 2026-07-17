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
   - `@capsule-sdk/adapter-docker`
   - `@capsule-sdk/adapter-mock`
   - `@capsule-sdk/adapter-e2b`
   - `@capsule-sdk/adapter-daytona`
   - `@capsule-sdk/adapter-modal`
   - `@capsule-sdk/adapter-cloud-run`
   - `@capsule-sdk/adapter-cloudflare`
   - `@capsule-sdk/adapter-vercel`
   - `@capsule-sdk/adapter-neon`
   - `@capsule-sdk/adapter-kubernetes`
   - `@capsule-sdk/adapter-lambda`
   - `@capsule-sdk/adapter-ecs`
   - `@capsule-sdk/adapter-ec2`
   - `@capsule-sdk/adapter-fly`
   - `@capsule-sdk/adapter-azure-container-apps`
   - `@capsule-sdk/ai`
   - `@capsule-sdk/cli`
   - `@capsule-sdk/preview`
   - `@capsule-sdk/store-jsonl`
   - `@capsule-sdk/store-sqlite`
4. Two-factor authentication and npm provenance requirements match the release workflow.
5. `NPM_TOKEN` is an automation token scoped to the organization/packages and stored only in GitHub Actions secrets.
6. The first release PR from Changesets is reviewed before publishing.

After publication, update README badges and install text to reflect actual npm availability.
