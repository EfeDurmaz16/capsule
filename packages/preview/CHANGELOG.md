# @capsule-sdk/preview

## 0.3.0

### Minor Changes

- 8a5abed: Preview environments derive their overall status from resource statuses via the exported `aggregatePreviewStatus` (any failed resource fails the preview, pending resources keep it creating) instead of a hardcoded ready. `previewUrlRegistry` and the new optional `urlEntries` field on PreviewEnvironment map each URL back to its resource id, type, and provider.

### Patch Changes

- ad23c6c: Preview cleanup no longer reports `partial` for resource kinds that have no cleanup action by design. Edge and job resources resolve to an `unsupported` disposition, and the overall cleanup status is now `cleaned`, `unsupported`, or `partial`; `capsule preview destroy` exits 0 when the only leftovers are unsupported and exits non-zero only for real failures. Its summary gains a `partial` bucket so partial dispositions are visible.

  `capsule receipt verify` gains `--public-key <path-or-value>` to authenticate ed25519 receipt signatures against `verifyReceipt`. Under `--require-signature`, a present-but-unverified signature now fails unless the caller passes `--allow-unverified-signatures`. An empty but readable store adds an explicit `receipts: 0` note and stays exit 0 except under `--require-signature`.

  Commands now resolve `capsule.config.json` from the working directory, applying its `adapter`, `receipts.path`, and `policyFile` when the matching flag is absent; explicit flags still override the file. The init plan notes that the scaffolded policy denies all environment keys by default.

  `capsule policy explain` coerces a string `now` from the spec file into a `Date` and rejects invalid dates with a clear error instead of a `TypeError`, and routes `approval.reason` and resource name/id/path fields through redaction before printing.

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
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

## 0.2.0

### Minor Changes

- d2daf31: Emit preview-level cleanup receipts and per-resource cleanup dispositions from preview orchestration.
- 1ec355b: Add real-provider guards for preview orchestration and mark mock adapter receipts with explicit mock metadata.

### Patch Changes

- 9f060c1: Restrict published package files and add release provenance hardening.
- f8848c0: Add explicit public npm publish configuration and Changesets release infrastructure.
- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
