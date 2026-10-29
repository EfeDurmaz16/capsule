# Release Operations

This is the release operations doc: readiness before the first publish, and rollback after a bad release.

## Publish Readiness

Capsule packages are not published to npm yet. Do not add npm version badges before the first successful publication.

Run the release audit before publishing:

```bash
pnpm build
pnpm release:audit
```

`pnpm release:audit` performs:

1. package metadata audit for every public `@capsule-sdk/*` package;
2. unfinished marker gate over shipped source;
3. `pnpm pack` for every public package, with a packed size budget and a tarball contents check (package metadata and `dist` output only; no tests, fixtures, sources or env files);
4. install smoke in a temporary fixture using the packed tarballs;
5. package-name import smoke for every packed package;
6. `@capsule-sdk/cli` bin smoke through `pnpm exec capsule capabilities`.

Before the first publish, verify manually with the npm account that will publish Capsule:

1. The npm organization for the `@capsule-sdk` scope, which every package manifest uses, exists and is controlled by the publishing team. The repository audit only checks that names use this scope; it cannot prove account ownership or registry availability.
2. The publishing account has owner or maintainer permission for `@capsule-sdk`.
3. Every intended public `@capsule-sdk/*` package name (ai, azure, bridge-worker, cli, cloud-run, cloudflare, core, daytona, docker, e2b, ec2, ecs, fly, kubernetes, lambda, mock, modal, neon, presets, preview, store-jsonl, store-sqlite, vercel) is available under it.
4. Two-factor authentication and npm provenance requirements match the release workflow.
5. `NPM_TOKEN` is an automation token scoped to the organization/packages and stored only in GitHub Actions secrets.
6. The first release PR from Changesets is reviewed before publishing.

After publication, update README badges and install text to reflect actual npm availability.

### What a green release job proves

The `Release` workflow runs on every push to `main`. While unreleased changesets exist, `changesets/action` only opens or updates the "chore: version packages" pull request; nothing is published. Publication runs only after that version PR is merged and no changesets remain, through `pnpm release` (`changeset publish`). A green `Release` run therefore is not evidence that anything was published. Confirm publication on the registry for each package and version (`npm view @capsule-sdk/<package>@<version> version dist.attestations`), then run `pnpm release:provenance` for the presence check below.

### Provenance check limits

`pnpm release:provenance` (`scripts/verify-published-provenance.mjs`) is a presence-only check. A package passes only when its registry `dist.attestations` names the npm attestations URL for the exact `name@version` and a SLSA provenance predicate type. Registry signatures are reported separately and never pass on their own. The script does not verify the attestation cryptographically and does not check the source repository or ref identity. Use `npm audit signatures` and the attestation bundle itself for that verification.

## Rollback

This section is for a bad Capsule npm release after packages have been published.

Capsule should prefer transparent repair over history rewriting. Most release failures should be handled with deprecation, a patch release, and clear notes. Unpublish is a last resort and may be constrained by npm policy.

## First Ten Minutes

1. Stop new publishes.
2. Identify the exact package names and versions affected.
3. Confirm whether the bad release is install-breaking, runtime-breaking, security-sensitive, or documentation-only.
4. Preserve evidence: CI run URL, Changesets release PR, npm package versions, failing command, and reproduction.
5. Do not force-push release tags or rewrite published package history.

## Severity

| Severity | Use when                                                                                                  | Default action                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| S0       | Secret leak, malicious package contents, destructive provider behavior, or false security/evidence claim. | Stop release train, rotate any affected credentials, deprecate immediately, publish fixed versions, and open a security advisory path. |
| S1       | Install failure, broken exports, broken CLI binary, wrong package files, or failed imports.               | Deprecate affected versions and publish patch versions.                                                                                |
| S2       | Runtime bug in one adapter, docs mismatch, metadata issue, or missing non-critical file.                  | Publish patch versions or document workaround, depending on blast radius.                                                              |
| S3       | Cosmetic README/package metadata typo with no runtime impact.                                             | Fix in next patch release unless the typo misleads users.                                                                              |

## Commands

Set the package and version explicitly before running npm commands:

```bash
PACKAGE='@capsule-sdk/core'
BAD_VERSION='0.1.1'
FIX_VERSION='0.1.2'
```

Inspect the published package:

```bash
npm view "$PACKAGE@$BAD_VERSION" --json
npm pack "$PACKAGE@$BAD_VERSION" --dry-run
```

Deprecate an affected version:

```bash
npm deprecate "$PACKAGE@$BAD_VERSION" "Do not use this Capsule release. Upgrade to $FIX_VERSION."
```

Publish a fixed version through the normal release path:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm release:audit
pnpm changeset
```

Then use the normal Changesets release workflow. Do not publish local one-off packages unless the workflow itself is broken and maintainers explicitly approve an emergency path.

## Hotfix Branch

Use a narrow hotfix branch:

```bash
git switch -c hotfix/package-release
```

Only include:

- the minimal code or metadata fix;
- a changeset for affected public packages;
- a test or pack-smoke regression when possible;
- a short release note explaining who is affected.

Before merging:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm release:audit
pnpm capsule:gap:check
pnpm docs:api:check
find packages -path '*/dist/*' -type f \( -name '*.test.*' -o -name '*.live.test.*' \) -print
```

The `find` command must print nothing.

## Package File Mistakes

If a package includes test files, live-test files, private notes, credentials, or stale build output:

1. Treat it as at least S1.
2. Verify the file list with `npm pack "$PACKAGE@$BAD_VERSION" --dry-run`.
3. Deprecate the bad version.
4. Fix the package file list or build pruning.
5. Add a regression to `scripts/package-publish-audit.mjs` or `scripts/package-pack-smoke.mjs`.
6. Publish a patch through the normal workflow.

If credentials were published, rotate them immediately even if npm deletion is possible.

## Broken Exports Or CLI

If consumers cannot import a package or run the CLI:

1. Reproduce from a clean temp directory.
2. Check `package.json` `exports`, `main`, `types`, and `bin`.
3. Add or update a package export smoke test.
4. Run `pnpm release:pack-smoke`.
5. Deprecate the bad version and publish a patch.

## Security Or Evidence Bugs

If the release weakens policy enforcement, receipt integrity, secret redaction, cleanup behavior, or live-provider safety:

1. Stop all automated release work.
2. Write a minimal reproduction and affected capability path.
3. Check whether provider resources could have leaked or executed unexpectedly.
4. Deprecate affected versions with a direct warning.
5. Prepare a security advisory path when users may be exposed.
6. Publish a fixed version only after focused regression tests and full release audit pass.

## Communication

Publish a short note with:

- affected packages and versions;
- whether users must upgrade;
- whether credentials or provider resources may be affected;
- fixed version;
- verification command for users;
- link to the changelog or advisory.

Do not overstate safety. If the issue is still under investigation, say that directly.
