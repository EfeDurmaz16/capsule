# @capsule-sdk/cli

## 0.1.2

### Patch Changes

- 72d873a: Concurrent sandbox sub-operations no longer silently drop receipts: adapter emission is tracked per operation instead of being inferred from the shared receipts array length. The default redaction profile now covers everything the receipt verifier flags (AWS access key ids, postgres connection URLs, password= fragments) from one shared credential pattern, and receipt command, source, and cwd fields are redacted at creation as defense in depth. The CLI preview cleanup file gained its own format identifier, capsule.cli.preview-cleanup-file.v1, while still accepting files written with the previous shared string.
- ad23c6c: Preview cleanup no longer reports `partial` for resource kinds that have no cleanup action by design. Edge and job resources resolve to an `unsupported` disposition, and the overall cleanup status is now `cleaned`, `unsupported`, or `partial`; `capsule preview destroy` exits 0 when the only leftovers are unsupported and exits non-zero only for real failures. Its summary gains a `partial` bucket so partial dispositions are visible.

  `capsule receipt verify` gains `--public-key <path-or-value>` to authenticate ed25519 receipt signatures against `verifyReceipt`. Under `--require-signature`, a present-but-unverified signature now fails unless the caller passes `--allow-unverified-signatures`. An empty but readable store adds an explicit `receipts: 0` note and stays exit 0 except under `--require-signature`.

  Commands now resolve `capsule.config.json` from the working directory, applying its `adapter`, `receipts.path`, and `policyFile` when the matching flag is absent; explicit flags still override the file. The init plan notes that the scaffolded policy denies all environment keys by default.

  `capsule policy explain` coerces a string `now` from the spec file into a `Date` and rejects invalid dates with a clear error instead of a `TypeError`, and routes `approval.reason` and resource name/id/path fields through redaction before printing.

- b14410b: Credential-shaped tokens (Bearer values, provider key prefixes, JWTs) are now redacted from Capsule-observed logs, receipts, and errors on every redaction profile, not only under `redactionProfile: "strict"`; matching is case-insensitive to stay consistent with `verifyReceipt`. The strict profile still adds the broad long-token catch-all. `capsule doctor` now reports Node versions below 22 as unsupported, matching the declared engines floor. The Azure Container Apps adapter reads HTTP status from the provider error classification as a fallback when detecting missing jobs.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 2856feb: `@capsule-sdk/core` gains three preset factories and an exported policy validator. `ciJobPreset` wraps `nodeJobPreset` with CI defaults (CI=true env, 15 minute timeout). `dockerLocalAgentPreset` wraps `nodeSandboxPreset` for a locally sandboxed Docker agent with a deny-by-default network. `costLimitedPreviewPreset` wraps `previewEnvironmentPreset` and adds a `policy.cost.maxUsd` spend cap (default $5). `validatePresetAgainstPolicy(preset, policy)` returns structured findings for allowlist, cost, ttl, and timeout issues; the previous private validators now delegate to it.

  `@capsule-sdk/presets` gains `cloudflareNeonPreviewPreset` and `vercelNeonPreviewPreset`, composing the existing edge and Neon presets the same way `flyVercelNeonPreviewPreset` does, and a static `presetCatalog` describing every core and provider preset for discovery.

  `@capsule-sdk/cli` gains `capsule receipt inspect --receipt-file <path> [--id <receiptId>]` (pretty-prints stored receipts without validating them), `capsule preset list` (table or `--json`) and `capsule preset explain <id>` over the catalog, and `capsule preview plan --config-file <path>` (a side-effect-free dry-run report). `capsule doctor` now honors `--provider` when filtering credential diagnostics.

- 03ec1d4: Trim five trivial single-call example packages (`deployment-model`, `edge-model`, `database-branch-model`, `machine-model`, `job-docker`) whose API calls are already shown in the README Domains section, and drop them from the changesets ignore list, root `tsconfig.json` references, and CLI example classification.

  Migrate the CLI argument parser to `node:util` `parseArgs` (non-strict token mode). Every flag and behavior is preserved: single-value flags, repeatable `--domain`/`--route`/`--subnet`/`--security-group`, boolean flags, numeric `--port`, and unknown tokens still falling through into `rest` in their original order.

- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [ad23c6c]
- Updated dependencies [a0d12be]
- Updated dependencies [b14410b]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [951af73]
- Updated dependencies [f78c06f]
  - @capsule-sdk/core@0.2.0
  - @capsule-sdk/docker@0.1.2
  - @capsule-sdk/neon@0.1.2
  - @capsule-sdk/cloud-run@0.1.2
  - @capsule-sdk/lambda@0.1.2
  - @capsule-sdk/ec2@0.1.2
  - @capsule-sdk/preview@0.3.0
  - @capsule-sdk/azure@0.1.2
  - @capsule-sdk/presets@0.1.2
  - @capsule-sdk/store-jsonl@0.1.2
  - @capsule-sdk/e2b@0.1.2
  - @capsule-sdk/daytona@0.1.2
  - @capsule-sdk/modal@0.1.2
  - @capsule-sdk/cloudflare@0.1.2
  - @capsule-sdk/kubernetes@0.1.2
  - @capsule-sdk/ecs@0.1.2
  - @capsule-sdk/fly@0.1.2
  - @capsule-sdk/mock@0.1.2
  - @capsule-sdk/vercel@0.1.2

## 0.1.1

### Patch Changes

- 9f060c1: Restrict published package files and add release provenance hardening.
- f8848c0: Add explicit public npm publish configuration and Changesets release infrastructure.
- Updated dependencies [5e2062e]
- Updated dependencies [bc2c86f]
- Updated dependencies [0501a7a]
- Updated dependencies [409969c]
- Updated dependencies [754f2da]
- Updated dependencies [71772ab]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
- Updated dependencies [0a3331f]
  - @capsule-sdk/azure@0.1.1
  - @capsule-sdk/cloud-run@0.1.1
  - @capsule-sdk/core@0.1.1
  - @capsule-sdk/cloudflare@0.1.1
  - @capsule-sdk/kubernetes@0.1.1
  - @capsule-sdk/docker@0.1.1
  - @capsule-sdk/lambda@0.1.1
  - @capsule-sdk/daytona@0.1.1
  - @capsule-sdk/e2b@0.1.1
  - @capsule-sdk/ec2@0.1.1
  - @capsule-sdk/ecs@0.1.1
  - @capsule-sdk/fly@0.1.1
  - @capsule-sdk/modal@0.1.1
  - @capsule-sdk/neon@0.1.1
  - @capsule-sdk/vercel@0.1.1
  - @capsule-sdk/store-jsonl@0.1.1
