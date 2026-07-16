---
"@capsule/preview": patch
"@capsule/cli": patch
---

Preview cleanup no longer reports `partial` for resource kinds that have no cleanup action by design. Edge and job resources resolve to an `unsupported` disposition, and the overall cleanup status is now `cleaned`, `unsupported`, or `partial`; `capsule preview destroy` exits 0 when the only leftovers are unsupported and exits non-zero only for real failures. Its summary gains a `partial` bucket so partial dispositions are visible.

`capsule receipt verify` gains `--public-key <path-or-value>` to authenticate ed25519 receipt signatures against `verifyReceipt`. Under `--require-signature`, a present-but-unverified signature now fails unless the caller passes `--allow-unverified-signatures`. An empty but readable store adds an explicit `receipts: 0` note and stays exit 0 except under `--require-signature`.

Commands now resolve `capsule.config.json` from the working directory, applying its `adapter`, `receipts.path`, and `policyFile` when the matching flag is absent; explicit flags still override the file. The init plan notes that the scaffolded policy denies all environment keys by default.

`capsule policy explain` coerces a string `now` from the spec file into a `Date` and rejects invalid dates with a clear error instead of a `TypeError`, and routes `approval.reason` and resource name/id/path fields through redaction before printing.
