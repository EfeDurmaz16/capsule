# Contributing

## Install

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Live Tests

Live provider tests must use `@capsule-sdk/test-utils` and remain skipped by default. The shared gate only enables live operations when `CAPSULE_LIVE_TESTS=1` is present and the provider-specific credential environment variables are set. In CI, live tests also require `CAPSULE_LIVE_TEST_CI_OPT_IN=1` or the `capsule:live-tests` pull request label, and untrusted fork pull requests are always blocked. Skip reasons should name the missing flag, credential variables, CI opt-in, or fork safety condition so CI output explains why a live test did not run.

## Add An Adapter

Start with [Adding a provider adapter](adding-provider-adapter.md) and the [Adapter contract](adapter-contract.md).

1. Classify the provider service with `capsule classify provider <provider> <service>`.
2. Scaffold the package with `capsule adapter scaffold <provider> --domain <domain>` when the default package shape fits.
3. Export a factory that returns `CapsuleAdapter`.
4. Declare a complete capability map.
5. Implement only the domains the provider supports.
6. Use `native`, `emulated`, `unsupported`, and `experimental` honestly.
7. Add contract tests.
8. Add docs and examples.

Adapter PRs are expected to explain:

- which runtime domains are implemented;
- which capabilities are `native`, `emulated`, `experimental`, or `unsupported`;
- which policy controls are provider-native, delegated, best-effort, or not supported;
- how credentials are loaded without printing secret values;
- which live tests are gated by `CAPSULE_LIVE_TESTS=1`;
- which provider-specific fields are exposed through `raw` or typed options.

## Release Gate

`pnpm release:markers` fails the release if shipped source under `packages`, `examples`, or `scripts` contains unfinished-work markers (`TODO`, `FIXME`, `stub`, `mock-level`, `technical-debt`). Generated `dist` output, dependencies, docs, and test files are exempt so tests and docs can describe the policy itself. `not implemented` is intentionally excluded because Capsule uses explicit unsupported-capability errors and provider limitation notes instead.

## CI Gates

`.github/workflows/ci.yml` runs four parallel jobs. Generated files are checked, never rewritten in CI: `pnpm capsule:gap:check` and `pnpm docs:api:check` fail on drift, and regenerating with `pnpm capsule:gap` or `pnpm docs:api` stays a developer action.

| Job                                       | Runtime | What it proves                                                                                                                                                                       |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typecheck, test, and build                | Node 24 | provider matrix and API reference current, format, typecheck, unit suite, build, release audit (metadata, licenses, markers, full 22-package pack smoke with tarball contents check) |
| Node 22 compatibility and package exports | Node 22 | unit suite on the declared Node 22 floor, export maps, engine-aware pack smoke (Node 24-only packages skipped) and packed CLI bin                                                    |
| Node 24 compatibility and package exports | Node 24 | export maps and engine-aware pack smoke                                                                                                                                              |
| Benchmark bounds                          | Node 24 | `pnpm bench:bounds`: deterministic resource counts and caps, never wall time                                                                                                         |

Critical path, measured before any consolidation on the last baseline CI run (7d3a28a, GitHub-hosted ubuntu-latest): the verify job took 129 s (build 47 s, test 21 s, release audit 17 s); each package-exports job took 88 s (build 47 to 49 s). The jobs run in parallel, so merging them would save runner minutes for the repeated build, not wall time, and would serialize the Node 22 and Node 24 checks. They stay separate. The Node 22 unit step adds about 21 s to an 88 s job and the benchmark job is about one build plus 10 s, both below the 129 s critical path. Local gate timings are recorded with `node benchmarks/run-gates.mjs --out <file>`.

A green CI or release job is not publication proof and not live-provider proof. Publication is confirmed only on the registry (see [Release and rollback](release-rollback.md)); live behavior only by an executed live run (see [Live tests](live-tests.md)).

## Official Provider Adapters

Provider teams are welcome to propose official adapters. An official adapter should have a named maintainer, provider-reviewed capability map, public quickstart, contract tests, skipped-by-default live tests, and compatibility notes for provider API changes.

Official ownership does not mean Capsule hides provider differences. It means the provider helps keep support levels, docs, examples, and security caveats accurate.

## Propose A Primitive

Open an issue describing the domain, operations, provider examples, abstraction risks, policy concerns, receipt fields, and why existing domains are insufficient.

## Issue Taxonomy

Use labels to make the task graph inspectable. The canonical label set (area, provider, and the `type:security` and `needs-verification` labels) lives in [issue labels](issue-labels.md); apply labels from there.

Task issues should include a source task ID when possible, success criteria, required verification, and explicit guardrails. Large features should be split by package or domain so each PR can stay reviewable and atomic.

## Good First Issues

Good first issues should produce real project value without requiring broad architecture changes:

- add contract tests for an existing mock adapter;
- improve provider matrix notes with a source link;
- add a focused example for one domain;
- improve policy notes for an adapter;
- document one provider-specific escape hatch;
- add a skipped-by-default live test fixture for one provider operation.

Avoid shallow issues such as typo-only churn, cosmetic badge changes without release value, or broad "research this provider" tickets without a concrete output.

## Ownership Model

Provider teams can own official adapters. Ownership means maintaining capability maps, docs, examples, tests, and compatibility notes when provider APIs change.
