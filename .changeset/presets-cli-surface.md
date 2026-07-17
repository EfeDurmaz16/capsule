---
"@capsule-sdk/core": patch
"@capsule-sdk/presets": patch
"@capsule-sdk/cli": patch
---

`@capsule-sdk/core` gains three preset factories and an exported policy validator. `ciJobPreset` wraps `nodeJobPreset` with CI defaults (CI=true env, 15 minute timeout). `dockerLocalAgentPreset` wraps `nodeSandboxPreset` for a locally sandboxed Docker agent with a deny-by-default network. `costLimitedPreviewPreset` wraps `previewEnvironmentPreset` and adds a `policy.cost.maxUsd` spend cap (default $5). `validatePresetAgainstPolicy(preset, policy)` returns structured findings for allowlist, cost, ttl, and timeout issues; the previous private validators now delegate to it.

`@capsule-sdk/presets` gains `cloudflareNeonPreviewPreset` and `vercelNeonPreviewPreset`, composing the existing edge and Neon presets the same way `flyVercelNeonPreviewPreset` does, and a static `presetCatalog` describing every core and provider preset for discovery.

`@capsule-sdk/cli` gains `capsule receipt inspect --receipt-file <path> [--id <receiptId>]` (pretty-prints stored receipts without validating them), `capsule preset list` (table or `--json`) and `capsule preset explain <id>` over the catalog, and `capsule preview plan --config-file <path>` (a side-effect-free dry-run report). `capsule doctor` now honors `--provider` when filtering credential diagnostics.
