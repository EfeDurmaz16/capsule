# @capsule-sdk/presets

## 0.1.2

### Patch Changes

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 2856feb: `@capsule-sdk/core` gains three preset factories and an exported policy validator. `ciJobPreset` wraps `nodeJobPreset` with CI defaults (CI=true env, 15 minute timeout). `dockerLocalAgentPreset` wraps `nodeSandboxPreset` for a locally sandboxed Docker agent with a deny-by-default network. `costLimitedPreviewPreset` wraps `previewEnvironmentPreset` and adds a `policy.cost.maxUsd` spend cap (default $5). `validatePresetAgainstPolicy(preset, policy)` returns structured findings for allowlist, cost, ttl, and timeout issues; the previous private validators now delegate to it.

  `@capsule-sdk/presets` gains `cloudflareNeonPreviewPreset` and `vercelNeonPreviewPreset`, composing the existing edge and Neon presets the same way `flyVercelNeonPreviewPreset` does, and a static `presetCatalog` describing every core and provider preset for discovery.

  `@capsule-sdk/cli` gains `capsule receipt inspect --receipt-file <path> [--id <receiptId>]` (pretty-prints stored receipts without validating them), `capsule preset list` (table or `--json`) and `capsule preset explain <id>` over the catalog, and `capsule preview plan --config-file <path>` (a side-effect-free dry-run report). `capsule doctor` now honors `--provider` when filtering credential diagnostics.

- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [a0d12be]
- Updated dependencies [b14410b]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [951af73]
- Updated dependencies [f78c06f]
  - @capsule-sdk/core@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
