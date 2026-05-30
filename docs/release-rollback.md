# Release Rollback Runbook

This runbook is for a bad Capsule npm release after packages have been published.

Capsule should prefer transparent repair over history rewriting. Most release failures should be handled with deprecation, a patch release, and clear notes. Unpublish is a last resort and may be constrained by npm policy.

## First Ten Minutes

1. Stop new publishes.
2. Identify the exact package names and versions affected.
3. Confirm whether the bad release is install-breaking, runtime-breaking, security-sensitive, or documentation-only.
4. Preserve evidence: CI run URL, Changesets release PR, npm package versions, failing command, and reproduction.
5. Do not force-push release tags or rewrite published package history.

## Severity

| Severity | Use when | Default action |
| --- | --- | --- |
| S0 | Secret leak, malicious package contents, destructive provider behavior, or false security/evidence claim. | Stop release train, rotate any affected credentials, deprecate immediately, publish fixed versions, and open a security advisory path. |
| S1 | Install failure, broken exports, broken CLI binary, wrong package files, or failed imports. | Deprecate affected versions and publish patch versions. |
| S2 | Runtime bug in one adapter, docs mismatch, metadata issue, or missing non-critical file. | Publish patch versions or document workaround, depending on blast radius. |
| S3 | Cosmetic README/package metadata typo with no runtime impact. | Fix in next patch release unless the typo misleads users. |

## Commands

Set the package and version explicitly before running npm commands:

```bash
PACKAGE='@capsule/core'
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
pnpm docs:api
git diff --exit-code docs/api-reference.md
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
