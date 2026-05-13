# Changesets

Use Changesets for package versioning and npm release notes.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

The release workflow opens a version PR on `main` when unpublished changesets exist. When that version PR is merged, the same workflow builds, tests, and publishes packages with `NPM_TOKEN`.

Examples and `@capsule/test-utils` are ignored because they are private workspace packages.

## Provenance And Tokens

The release workflow grants `id-token: write` and sets `NPM_CONFIG_PROVENANCE=true` so npm can attach GitHub Actions provenance to published packages.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish permission for the `@capsule` scope.

Before publishing, CI runs `pnpm release:audit` to check that public packages have explicit `publishConfig.access=public`, a narrow `files` allowlist, built `dist` entrypoints, and no example or harness package is publishable.
