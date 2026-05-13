# Changesets

Use Changesets for package versioning and npm release notes.

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

The release workflow opens a version PR on `main` when unpublished changesets exist. When that version PR is merged, the same workflow builds, tests, and publishes packages with `NPM_TOKEN`.

Examples and `@capsule/test-utils` are ignored because they are private workspace packages.
