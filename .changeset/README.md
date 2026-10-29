# Changesets

Use Changesets for package versioning and npm release notes.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

The release workflow opens or updates a version PR on `main` while unreleased changesets exist; that run publishes nothing. When the version PR is merged and no changesets remain, the same workflow verifies, builds and runs `pnpm release` (`changeset publish`) with `NPM_TOKEN`. A green workflow run is not publication proof: confirm each `@capsule-sdk/<package>@<version>` on the registry. See [Release operations](../docs/release-rollback.md).

Examples and `@capsule-sdk/test-utils` are ignored because they are private workspace packages.

## Provenance And Tokens

The release workflow grants `id-token: write` and sets `NPM_CONFIG_PROVENANCE=true` so npm can attach GitHub Actions provenance to published packages. `pnpm release:provenance` later checks only that the registry lists a SLSA provenance attestation for each exact version; it reports registry signatures separately, never treats a signature as provenance, and does not verify the attestation or the repository identity cryptographically.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish permission for the `@capsule-sdk` scope.

Before publishing, CI runs `pnpm release:audit` to check that public packages have explicit `publishConfig.access=public`, a narrow `files` allowlist, built `dist` entrypoints, packed tarballs that contain only metadata and `dist` output, and no example or harness package is publishable.

## Release Notes

When preparing a Changesets release PR, GitHub release, or npm publish summary, group changes by domain so users can quickly separate core policy/receipt changes, provider adapter behavior, CLI and example updates, documentation-only changes, security/evidence implications, and breaking changes.

Every release note should include the exact verification commands that ran for the release. At minimum, include:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm release:audit
pnpm capsule:gap:check
pnpm docs:api:check
```
