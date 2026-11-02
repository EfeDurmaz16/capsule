# @capsule-sdk/preview

## 0.3.0

### Minor Changes

- 8a5abed: Preview environments derive their overall status from resource statuses via the exported `aggregatePreviewStatus` (any failed resource fails the preview, pending resources keep it creating) instead of a hardcoded ready. `previewUrlRegistry` and the new optional `urlEntries` field on PreviewEnvironment map each URL back to its resource id, type, and provider.
- 263c73d: Add a fresh per-action cleanup approval resolver. `cleanupPreviewEnvironment(..., { approval })` and `createPreviewEnvironmentWithCleanup(plan, { cleanupApproval })` call a `CleanupApprovalResolver` before each delete with the capability path and the exact resource scope Capsule core checks. A returned grant is sent on that delete only; `undefined` denies it, sends no delete and reports the resource as `leaked`. Create grants are never reused for cleanup. Without a resolver, behavior is unchanged.
- e07e2e0: Bind preview cleanup to graph-local resource references instead of provider-native ids.

  - Every resource created by `createPreviewGraph` and `createPreviewEnvironmentWithCleanup` gets a `ref` that is unique within the preview graph. Cleanup plan actions carry `resourceRef`, `resourceAdapter` and `resourceScope` (for example the database project), and `actionId`/`idempotencyKey` are now built from the ref, so two resources with the same native id (across providers, or across projects of one provider) get distinct actions and each one is deleted through its own Capsule with its own spec.
  - `cleanupPreviewEnvironment(..., { cleanupPlan })` validates the supplied plan before the first delete. A plan whose `previewId` differs from the preview, an action whose kind, provider, native id or cleanup identity does not match its resource, or duplicate actions now throw `PreviewCleanupPlanError` with no provider calls.
  - Plans serialized before `resourceRef` existed are still accepted when each action matches exactly one resource with the same kind, capability, provider, native id and cleanup identity. Ambiguous legacy plans are rejected instead of guessed.
  - Receipt metadata and the plan resource list join on the graph-local ref instead of searching by native id.

- ff28c78: `PreviewCreationError` now carries `resources` (the resources created before the failure, with their cleanup bindings to the original Capsules), a `cleanupPlan` for exactly those resources, and their provider `receipts`. Callers of `createPreviewGraph`, which does not clean up on failure, can pass them to `cleanupPreviewEnvironment` without reconstructing provider identity. Both create variants now share one provisioning executor, so their creation order and partial-failure data are the same.
- e907c2d: Keep a failing step's leftover resources and check every child's policy before the first create.

  When a create step fails with a structured partial-effects record (`CleanupFailureError` or `PartialEffectsError`), or with an unknown or pending outcome that names a resource, the resources it may have left behind are now appended to `PreviewCreationError.resources` with a new `residual` field (step order, operation, outcome and the safe provider locator). A Neon branch residual is bound to a normal `database.branchDelete` cleanup action, so compensation and later cleanup try to delete it. Residuals without a matching preview cleanup action (for example a Kubernetes Deployment or a Cloudflare Worker) are reported as `leaked`, so cleanup status is `partial` instead of `cleaned` while they may still exist. Before, the residual was dropped and cleanup reported `cleaned`.

  `createPreviewGraph` and `createPreviewEnvironmentWithCleanup` now check capability support and policy for every child before the first provider call. A denial of a later child (for example an env key the secrets policy does not allow) is reported as `PreviewCreationError` with the policy error as `cause` and no resources, instead of being found after earlier children already exist.

- 031fcf5: Preview TTL is now labeled for what it is. `PreviewPlan.ttlMs` is recorded as `ttl: { requestedMs, enforcement: "record-only" }` in the dry-run and `preview.create` receipt metadata; the package has no expiry controller and does not pass the value to child resources. New `PreviewPlan.ttlEnforcement: "required"` rejects creation with `UnsupportedCapabilityError` (`preview.ttl`) before any provider call. Preset notes and catalog descriptions no longer imply provider-side expiry for Neon branches or composed previews.
- 7e0bd5a: `createPreviewId` appends a random component, so two previews with the same name created in the same millisecond no longer share a preview id, cleanup plan id or cleanup idempotency keys. New optional `PreviewPlan.operationId` records a caller-stable operation identity on the cleanup plan (`operationId`) and in the `preview.create` receipt metadata. It is kept separate from the per-run preview id; cleanup idempotency keys remain scoped to the run.

### Patch Changes

- ad23c6c: Preview cleanup no longer reports `partial` for resource kinds that have no cleanup action by design. Edge and job resources resolve to an `unsupported` disposition, and the overall cleanup status is now `cleaned`, `unsupported`, or `partial`; `capsule preview destroy` exits 0 when the only leftovers are unsupported and exits non-zero only for real failures. Its summary gains a `partial` bucket so partial dispositions are visible.

  `capsule receipt verify` gains `--public-key <path-or-value>` to authenticate ed25519 receipt signatures against `verifyReceipt`. Under `--require-signature`, a present-but-unverified signature now fails unless the caller passes `--allow-unverified-signatures`. An empty but readable store adds an explicit `receipts: 0` note and stays exit 0 except under `--require-signature`.

  Commands now resolve `capsule.config.json` from the working directory, applying its `adapter`, `receipts.path`, and `policyFile` when the matching flag is absent; explicit flags still override the file. The init plan notes that the scaffolded policy denies all environment keys by default.

  `capsule policy explain` coerces a string `now` from the spec file into a `Date` and rejects invalid dates with a clear error instead of a `TypeError`, and routes `approval.reason` and resource name/id/path fields through redaction before printing.

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 913af61: `aggregatePreviewStatus` treats a `cancelled` (or `canceled`) resource as failed, so a cancelled check job can no longer make a preview `ready`. Running services remain ready-eligible; running jobs and unknown statuses keep their existing behavior, which is now documented.
- 467b824: Let a cleanup approval resolver tell same-id resources apart.

  `CleanupApprovalRequest` gains an optional `context` with the resource provider, the adapter name of the Capsule that runs the cleanup, the graph-local `resourceRef`, the cleanup `actionId`, the `previewId` and the provider `scope` (for example the database project). Preview cleanup fills it for every request, so two services named `web` in different namespaces or on different providers no longer produce identical requests. The request `resource` and the approval hint Capsule core evaluates for `service.delete` and `database.branchDelete` now both carry the adapter `provider`, so a grant scoped to one provider matches only that provider's resource. A grant scoped without `provider` matches as before.

- ab0d1ea: The aggregate `preview.create` receipt from `createPreviewGraph` now starts its clock before the first provisioning call, so `startedAt` and `durationMs` cover the provider work instead of reporting about 0 ms. Benchmarks should still measure their own wall clock independently of receipt durations.
- 0d44630: Clean up ref-less resource records that share a native id again.

  `cleanupPreviewEnvironment(preview, records)` without a `cleanupPlan`, or with a plan made by `createPreviewCleanupPlan` from the same records, threw `PreviewCleanupPlanError` ("ambiguous") when two records without `ref` had the same kind, provider and id, for example two Kubernetes services named `web` in different namespaces. A ref-less record now binds first to the action the plan generated for its own position, and each record is deleted through its own Capsule. Legacy plans whose actions carry no `resourceRef` still bind only by an unambiguous identity match.

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
