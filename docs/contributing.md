# Contributing

## Install

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Add An Adapter

1. Create a package under `packages/adapter-*`.
2. Export a factory that returns `CapsuleAdapter`.
3. Declare a complete capability map.
4. Implement only the domains the provider supports.
5. Use `native`, `emulated`, `unsupported`, and `experimental` honestly.
6. Add contract tests.
7. Add docs and examples.

## Propose A Primitive

Open an issue describing the domain, operations, provider examples, abstraction risks, policy concerns, receipt fields, and why existing domains are insufficient.

## Good First Issues

- Add contract tests for an existing mock adapter.
- Improve provider matrix notes.
- Add a focused example for a domain.
- Improve policy notes for an adapter.
- Add documentation for a provider-specific escape hatch.

## Ownership Model

Provider teams can own official adapters. Ownership means maintaining capability maps, docs, examples, tests, and compatibility notes when provider APIs change.
