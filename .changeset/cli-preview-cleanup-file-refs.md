---
"@capsule-sdk/cli": minor
---

Bind preview cleanup files by graph-local resource ref and validate them before destroy.

`capsule preview create --cleanup-file` now joins each resource to its cleanup action by the preview graph's resource `ref` instead of the provider-native id, and writes that `ref` on every resource. Before, two resources with the same native id (for example Neon branches of the same name in two projects) could both record the same action and spec. `capsule preview destroy` now validates every action field instead of casting the file, and passes the recorded plan to `@capsule-sdk/preview`, which rejects a foreign `previewId`, a tampered action identity or an ambiguous legacy action with `PreviewCleanupPlanError` before the first delete. `--hard-delete`, `--force` and `--reason` apply to the bound action. Files written before refs existed are still accepted when each action matches exactly one resource.
