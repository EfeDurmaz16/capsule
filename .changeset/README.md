# Changesets

Use Changesets for package versioning and npm release notes.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

The release workflow opens a version PR on `main` when unpublished changesets exist. When that version PR is merged, the same workflow builds, tests, and publishes packages with `NPM_TOKEN`.

Examples and `@capsule-sdk/test-utils` are ignored because they are private workspace packages.

## Provenance And Tokens

The release workflow grants `id-token: write` and sets `NPM_CONFIG_PROVENANCE=true` so npm can attach GitHub Actions provenance to published packages.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish permission for the `@capsule` scope.

Before publishing, CI runs `pnpm release:audit` to check that public packages have explicit `publishConfig.access=public`, a narrow `files` allowlist, built `dist` entrypoints, and no example or harness package is publishable.

## Release Notes

When preparing a Changesets release PR, GitHub release, or npm publish summary, group changes by domain so users can quickly separate core policy/receipt changes, provider adapter behavior, CLI and example updates, documentation-only changes, security/evidence implications, and breaking changes.

Every release note should include the exact verification commands that ran for the release. At minimum, include:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm release:audit
pnpm docs:api
git diff --exit-code docs/api-reference.md
```
