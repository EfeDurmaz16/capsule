---
"@capsule-sdk/cli": minor
---

Reject unknown adapter names instead of falling back to Docker.

An explicit `--adapter`, a `capsule.config.json` adapter or a preview config adapter that Capsule does not know now fails before any provider is created, and the error lists the valid names. Docker is still the default when no adapter is selected at all. Known `mock-*` adapter names now select the matching mock adapter for every command instead of silently running Docker.
