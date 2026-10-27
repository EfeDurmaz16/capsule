---
"@capsule-sdk/cli": minor
---

`capsule neon branch-create` and `capsule neon branch-delete` now use the Neon adapter without needing `--adapter neon`.

An explicit `--adapter` wins over `capsule.config.json`, and whichever is present must be `neon` or `mock-neon`. A contradictory selection, such as a project config with `adapter: "docker"`, is rejected with a message instead of being rerouted to another provider.
