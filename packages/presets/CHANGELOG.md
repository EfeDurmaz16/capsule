# @capsule-sdk/presets

## 0.1.2

### Patch Changes

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 2856feb: `@capsule-sdk/core` gains three preset factories and an exported policy validator. `ciJobPreset` wraps `nodeJobPreset` with CI defaults (CI=true env, 15 minute timeout). `dockerLocalAgentPreset` wraps `nodeSandboxPreset` for a locally sandboxed Docker agent with a deny-by-default network. `costLimitedPreviewPreset` wraps `previewEnvironmentPreset` and adds a `policy.cost.maxUsd` spend cap (default $5). `validatePresetAgainstPolicy(preset, policy)` returns structured findings for allowlist, cost, ttl, and timeout issues; the previous private validators now delegate to it.

  `@capsule-sdk/presets` gains `cloudflareNeonPreviewPreset` and `vercelNeonPreviewPreset`, composing the existing edge and Neon presets the same way `flyVercelNeonPreviewPreset` does, and a static `presetCatalog` describing every core and provider preset for discovery.

  `@capsule-sdk/cli` gains `capsule receipt inspect --receipt-file <path> [--id <receiptId>]` (pretty-prints stored receipts without validating them), `capsule preset list` (table or `--json`) and `capsule preset explain <id>` over the catalog, and `capsule preview plan --config-file <path>` (a side-effect-free dry-run report). `capsule doctor` now honors `--provider` when filtering credential diagnostics.

- 031fcf5: Preview TTL is now labeled for what it is. `PreviewPlan.ttlMs` is recorded as `ttl: { requestedMs, enforcement: "record-only" }` in the dry-run and `preview.create` receipt metadata; the package has no expiry controller and does not pass the value to child resources. New `PreviewPlan.ttlEnforcement: "required"` rejects creation with `UnsupportedCapabilityError` (`preview.ttl`) before any provider call. Preset notes and catalog descriptions no longer imply provider-side expiry for Neon branches or composed previews.
- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [fbae6f0]
- Updated dependencies [70cee7f]
- Updated dependencies [0f6ef03]
- Updated dependencies [42953dc]
- Updated dependencies [6488af5]
- Updated dependencies [45d50ee]
- Updated dependencies [a0d12be]
- Updated dependencies [1488e6a]
- Updated dependencies [fd7307a]
- Updated dependencies [e65957b]
- Updated dependencies [cf1ba2a]
- Updated dependencies [b14410b]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [467b824]
- Updated dependencies [951af73]
- Updated dependencies [2dc1196]
- Updated dependencies [575c614]
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
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
