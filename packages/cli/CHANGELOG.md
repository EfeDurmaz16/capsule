# @capsule-sdk/cli

## 0.2.0

### Minor Changes

- 87f2f75: Reject unknown adapter names instead of falling back to Docker.

  An explicit `--adapter`, a `capsule.config.json` adapter or a preview config adapter that Capsule does not know now fails before any provider is created, and the error lists the valid names. Docker is still the default when no adapter is selected at all. Known `mock-*` adapter names now select the matching mock adapter for every command instead of silently running Docker.

- 309ea66: Enforce the configured policy on CLI executions.

  `--policy-file`, or `policyFile` from `capsule.config.json` when the flag is absent, was only read by `capsule policy explain`. It is now loaded once, frozen, and passed to every Capsule the CLI creates for `run`, `sandbox`, `job`, `service`, `machine`, `edge`, `neon` and `preview plan/create/destroy`, including each preview child. A denied policy (for example `approvals.required` with no grant) now stops the command before any provider call, and `network.mode: "none"` reaches the Docker arguments. A selected policy file that is missing, is not JSON, is not an object, has an unknown top-level section or an invalid `network.mode` fails before any provider is created. Projects scaffolded by `capsule init` will now have their scaffolded policy applied, including its deny-all `secrets.allowed: []` and output limits.

- cdd11fa: Load provider adapter packages only when a command selects them.

  Help, shell completion, preset, receipt and policy commands no longer import every provider SDK at startup. On a local Node 22 run, `capsule completion bash` went from about 0.42 s and 210 MB peak RSS to about 0.03 s and 50 MB; commands that select one adapter load only that package. Programmatic callers note: the exported `compareProviderCapabilities()` and `selectProvidersForRecipe()` helpers now return Promises and must be awaited.

- 804720d: `capsule neon branch-create` and `capsule neon branch-delete` now use the Neon adapter without needing `--adapter neon`.

  An explicit `--adapter` wins over `capsule.config.json`, and whichever is present must be `neon` or `mock-neon`. A contradictory selection, such as a project config with `adapter: "docker"`, is rejected with a message instead of being rerouted to another provider.

- c69c0d5: Bind preview cleanup files by graph-local resource ref and validate them before destroy.

  `capsule preview create --cleanup-file` now joins each resource to its cleanup action by the preview graph's resource `ref` instead of the provider-native id, and writes that `ref` on every resource. Before, two resources with the same native id (for example Neon branches of the same name in two projects) could both record the same action and spec. `capsule preview destroy` now validates every action field instead of casting the file, and passes the recorded plan to `@capsule-sdk/preview`, which rejects a foreign `previewId`, a tampered action identity or an ambiguous legacy action with `PreviewCleanupPlanError` before the first delete. `--hard-delete`, `--force` and `--reason` apply to the bound action. Files written before refs existed are still accepted when each action matches exactly one resource.

### Patch Changes

- 72d873a: Concurrent sandbox sub-operations no longer silently drop receipts: adapter emission is tracked per operation instead of being inferred from the shared receipts array length. The default redaction profile now covers everything the receipt verifier flags (AWS access key ids, postgres connection URLs, password= fragments) from one shared credential pattern, and receipt command, source, and cwd fields are redacted at creation as defense in depth. The CLI preview cleanup file gained its own format identifier, capsule.cli.preview-cleanup-file.v1, while still accepting files written with the previous shared string.
- c09b0c0: The `capsule` command now runs when node starts it through a symlink, which is how npm links package bins on macOS and Linux and how paths under `/tmp` resolve on macOS. It compared `process.argv[1]` with the module URL as strings, so started through a link it exited 0 without running any command. Both paths are now resolved before comparing.
- 4cf28ff: `capsule live-test plan` and `live-test validate` now list the optional switches that the live suites already read: `CAPSULE_CLOUD_RUN_JOB_IMAGE` for the billable Cloud Run job smoke, and `CAPSULE_CLOUDFLARE_LIVE_DEPLOY` and `CAPSULE_CLOUDFLARE_LIVE_ROLLBACK` for the Cloudflare deploy and rollback smokes. The plans also say that the dispatched live workflow does not set these switches. Required env, cost gates and commands are unchanged. A parity test now keeps the CLI plan, `scripts/live-test-matrix.mjs`, the `@capsule-sdk/test-utils` gates and the workflow secret mapping in step.
- f7e7348: Keep recovery bindings when `capsule preview create` fails part-way.

  When creation fails after some resources exist, the CLI now writes their cleanup bindings, and any residual locator from the failed step, to `--cleanup-file` before it rethrows, so `capsule preview destroy --cleanup-file <file>` can remove them. Without `--cleanup-file` the same bindings are printed to stderr. Before, nothing was written or printed and the created resources could only be found in the error message. Cleanup files now also carry an optional `residual` field per resource, which `preview destroy` validates and reports as leaked when no cleanup action exists for it.

- ad23c6c: Preview cleanup no longer reports `partial` for resource kinds that have no cleanup action by design. Edge and job resources resolve to an `unsupported` disposition, and the overall cleanup status is now `cleaned`, `unsupported`, or `partial`; `capsule preview destroy` exits 0 when the only leftovers are unsupported and exits non-zero only for real failures. Its summary gains a `partial` bucket so partial dispositions are visible.

  `capsule receipt verify` gains `--public-key <path-or-value>` to authenticate ed25519 receipt signatures against `verifyReceipt`. Under `--require-signature`, a present-but-unverified signature now fails unless the caller passes `--allow-unverified-signatures`. An empty but readable store adds an explicit `receipts: 0` note and stays exit 0 except under `--require-signature`.

  Commands now resolve `capsule.config.json` from the working directory, applying its `adapter`, `receipts.path`, and `policyFile` when the matching flag is absent; explicit flags still override the file. The init plan notes that the scaffolded policy denies all environment keys by default.

  `capsule policy explain` coerces a string `now` from the spec file into a `Date` and rejects invalid dates with a clear error instead of a `TypeError`, and routes `approval.reason` and resource name/id/path fields through redaction before printing.

- 0f9dfde: The adapter package scaffold now names its `runCapsuleAdapterContract` test "passes the guard-only adapter contract checks", because that runner checks declarations and guards only and runs no successful lifecycle.
- 103b943: Reject wrongly typed config values and unknown policy fields instead of dropping them.

  A `capsule.config.json` whose `adapter` or `policyFile` is present but not a string (an array, an object or `null`), or whose `receipts` block has a wrongly typed `enabled` or `path`, now fails before any provider is created. Before, such a value was ignored, so the command ran on the Docker default with no policy. A `capsule.config.json` that exists but cannot be read (for example a permission error or a directory) now fails too; only a missing file means "no config". A policy file now also rejects unknown fields inside a known section (for example `approvals.requried`), wrongly typed field values and an unknown `secrets.redactionProfile`, since policy evaluation reads fields by exact name and would otherwise skip the restriction.

- b14410b: Credential-shaped tokens (Bearer values, provider key prefixes, JWTs) are now redacted from Capsule-observed logs, receipts, and errors on every redaction profile, not only under `redactionProfile: "strict"`; matching is case-insensitive to stay consistent with `verifyReceipt`. The strict profile still adds the broad long-token catch-all. `capsule doctor` now reports Node versions below 22 as unsupported, matching the declared engines floor. The Azure Container Apps adapter reads HTTP status from the provider error classification as a fallback when detecting missing jobs.
- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- 2856feb: `@capsule-sdk/core` gains three preset factories and an exported policy validator. `ciJobPreset` wraps `nodeJobPreset` with CI defaults (CI=true env, 15 minute timeout). `dockerLocalAgentPreset` wraps `nodeSandboxPreset` for a locally sandboxed Docker agent with a deny-by-default network. `costLimitedPreviewPreset` wraps `previewEnvironmentPreset` and adds a `policy.cost.maxUsd` spend cap (default $5). `validatePresetAgainstPolicy(preset, policy)` returns structured findings for allowlist, cost, ttl, and timeout issues; the previous private validators now delegate to it.

  `@capsule-sdk/presets` gains `cloudflareNeonPreviewPreset` and `vercelNeonPreviewPreset`, composing the existing edge and Neon presets the same way `flyVercelNeonPreviewPreset` does, and a static `presetCatalog` describing every core and provider preset for discovery.

  `@capsule-sdk/cli` gains `capsule receipt inspect --receipt-file <path> [--id <receiptId>]` (pretty-prints stored receipts without validating them), `capsule preset list` (table or `--json`) and `capsule preset explain <id>` over the catalog, and `capsule preview plan --config-file <path>` (a side-effect-free dry-run report). `capsule doctor` now honors `--provider` when filtering credential diagnostics.

- f2e11e9: `JsonlReceiptStore` gains `iterate()`, an async iterator that reads receipts one line at a time: only one 1 MiB read chunk, the current line and the receipt being yielded stay in memory, and breaking out of the loop closes the file. `readAll()` now collects the same reader, in 4 MiB chunks, instead of reading and splitting the whole file, so it no longer holds the file text next to the parsed receipts, with the same order, blank-line handling, missing-file result and `path:line` corruption errors. Both read a regular file up to its size when the read started, as `readFile` did, and no longer fail on files larger than the maximum string length. New `maxLineBytes` option (store or per read, default 16 MiB, exported as `DEFAULT_MAX_JSONL_LINE_BYTES`): a longer line fails with its line number. `capsule receipt verify` verifies receipts as they stream and `receipt inspect --id` keeps only the matching receipts; their output is unchanged, and a corrupt line part-way still reports the store unreadable with no partial results.
- 03ec1d4: Trim five trivial single-call example packages (`deployment-model`, `edge-model`, `database-branch-model`, `machine-model`, `job-docker`) whose API calls are already shown in the README Domains section, and drop them from the changesets ignore list, root `tsconfig.json` references, and CLI example classification.

  Migrate the CLI argument parser to `node:util` `parseArgs` (non-strict token mode). Every flag and behavior is preserved: single-value flags, repeatable `--domain`/`--route`/`--subnet`/`--security-group`, boolean flags, numeric `--port`, and unknown tokens still falling through into `rest` in their original order.

- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [41120a7]
- Updated dependencies [3b40bda]
- Updated dependencies [d4f0ec1]
- Updated dependencies [fbae6f0]
- Updated dependencies [ad23c6c]
- Updated dependencies [f1795f8]
- Updated dependencies [d4f0ec1]
- Updated dependencies [4aba7ff]
- Updated dependencies [ce5ce4e]
- Updated dependencies [bcb76a4]
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
- Updated dependencies [8d6ac02]
- Updated dependencies [b14410b]
- Updated dependencies [243ad90]
- Updated dependencies [048a7cf]
- Updated dependencies [9384ef9]
- Updated dependencies [44af187]
- Updated dependencies [0bc3612]
- Updated dependencies [469b9fe]
- Updated dependencies [8d79470]
- Updated dependencies [b333df7]
- Updated dependencies [8478955]
- Updated dependencies [5b22cf6]
- Updated dependencies [b63ab96]
- Updated dependencies [c6dbad7]
- Updated dependencies [da2d15a]
- Updated dependencies [3ef4c9a]
- Updated dependencies [b5d1a87]
- Updated dependencies [4f742dd]
- Updated dependencies [4b7ca1e]
- Updated dependencies [80c89cb]
- Updated dependencies [641edf5]
- Updated dependencies [df0632d]
- Updated dependencies [bc69c09]
- Updated dependencies [50858a5]
- Updated dependencies [6c9edbd]
- Updated dependencies [faa6dc7]
- Updated dependencies [6a08ec3]
- Updated dependencies [0e9066a]
- Updated dependencies [0fd7cd3]
- Updated dependencies [d996e65]
- Updated dependencies [b82bc6a]
- Updated dependencies [d4f0ec1]
- Updated dependencies [9740e4b]
- Updated dependencies [297753f]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [73835ae]
- Updated dependencies [92acb2a]
- Updated dependencies [65aa385]
- Updated dependencies [de65056]
- Updated dependencies [e2c9cde]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [913af61]
- Updated dependencies [467b824]
- Updated dependencies [263c73d]
- Updated dependencies [ab0d1ea]
- Updated dependencies [e07e2e0]
- Updated dependencies [ff28c78]
- Updated dependencies [0d44630]
- Updated dependencies [e907c2d]
- Updated dependencies [031fcf5]
- Updated dependencies [7e0bd5a]
- Updated dependencies [951af73]
- Updated dependencies [2dc1196]
- Updated dependencies [575c614]
- Updated dependencies [f2e11e9]
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
- Updated dependencies [e4909ef]
- Updated dependencies [004c553]
  - @capsule-sdk/core@0.2.0
  - @capsule-sdk/docker@0.2.0
  - @capsule-sdk/neon@0.2.0
  - @capsule-sdk/cloud-run@0.2.0
  - @capsule-sdk/lambda@0.2.0
  - @capsule-sdk/ec2@0.2.0
  - @capsule-sdk/ecs@0.2.0
  - @capsule-sdk/azure@0.2.0
  - @capsule-sdk/vercel@0.2.0
  - @capsule-sdk/cloudflare@0.2.0
  - @capsule-sdk/fly@0.2.0
  - @capsule-sdk/preview@0.3.0
  - @capsule-sdk/daytona@0.2.0
  - @capsule-sdk/e2b@0.2.0
  - @capsule-sdk/kubernetes@0.2.0
  - @capsule-sdk/presets@0.1.2
  - @capsule-sdk/store-jsonl@0.2.0
  - @capsule-sdk/modal@0.2.0
  - @capsule-sdk/mock@0.1.2

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
