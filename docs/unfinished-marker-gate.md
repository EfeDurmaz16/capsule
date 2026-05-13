# Unfinished Marker Gate

`pnpm release:markers` fails when shipped source contains unfinished-work markers:

- `TODO`
- `FIXME`
- `stub`
- `mock-level` or `mock level`
- `technical-debt` or `technical debt`

The gate scans `packages`, `examples`, and `scripts` source files. It ignores generated `dist` output and dependencies.

The only allowlisted places for these words are explanatory docs and test files. That keeps release artifacts from shipping placeholder language while still allowing tests and docs to describe the policy itself.

`not implemented` is not part of this marker gate because Capsule intentionally uses explicit unsupported capability errors and provider limitation notes. Those must remain concrete and capability-specific rather than vague placeholders.
