---
"@capsule-sdk/cli": minor
---

Load provider adapter packages only when a command selects them.

Help, shell completion, preset, receipt and policy commands no longer import every provider SDK at startup. On a local Node 22 run, `capsule completion bash` went from about 0.42 s and 210 MB peak RSS to about 0.03 s and 50 MB; commands that select one adapter load only that package. Programmatic callers note: the exported `compareProviderCapabilities()` and `selectProvidersForRecipe()` helpers now return Promises and must be awaited.
