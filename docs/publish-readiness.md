# Publish Readiness

Capsule packages are not published to npm yet. Do not add npm version badges before the first successful publication.

Run the release audit before publishing:

```bash
pnpm build
pnpm release:audit
```

`pnpm release:audit` performs:

1. package metadata audit for every public `@capsule/*` package;
2. unfinished marker gate over shipped source;
3. `pnpm pack` dry run for every public package;
4. install smoke in a temporary fixture using the packed tarballs;
5. package-name import smoke for every packed package;
6. `@capsule/cli` bin smoke through `pnpm exec capsule capabilities`.

## Npm Ownership Checks

Before the first publish, verify these manually with the npm account that will publish Capsule:

1. The npm organization `@capsule` exists or is intentionally unavailable and a final namespace decision has been made.
2. The publishing account has owner or maintainer permission for the `@capsule` organization.
3. Every intended public package name is available under the chosen namespace:
   - `@capsule/core`
   - `@capsule/adapter-docker`
   - `@capsule/adapter-mock`
   - `@capsule/adapter-e2b`
   - `@capsule/adapter-daytona`
   - `@capsule/adapter-modal`
   - `@capsule/adapter-cloud-run`
   - `@capsule/adapter-cloudflare`
   - `@capsule/adapter-vercel`
   - `@capsule/adapter-neon`
   - `@capsule/adapter-kubernetes`
   - `@capsule/adapter-lambda`
   - `@capsule/adapter-ecs`
   - `@capsule/adapter-ec2`
   - `@capsule/adapter-fly`
   - `@capsule/adapter-azure-container-apps`
   - `@capsule/ai`
   - `@capsule/cli`
   - `@capsule/preview`
   - `@capsule/store-jsonl`
4. Two-factor authentication and npm provenance requirements match the release workflow.
5. `NPM_TOKEN` is an automation token scoped to the organization/packages and stored only in GitHub Actions secrets.
6. The first release PR from Changesets is reviewed before publishing.

After publication, update README badges and install text to reflect actual npm availability.
