# Execution Receipts

Receipts record runtime actions across sandboxes, jobs, services, edge deployments, database branches, previews, and machines.

## When a receipt is created

- Receipt capture is off by default. A `Capsule` records receipts only when constructed with `receipts: true`, and only for calls made through the Capsule facade. A `receiptStore` persists receipts; it does not turn capture on by itself.
- Governed actions that create, run, change or delete something (sandbox create/exec/destroy, job run, service deploy/delete, edge deploy, database branch create/delete, machine lifecycle) return a receipt on their result when capture is enabled.
- Read-only coverage is uneven across adapters. Some record `job.status`, `service.status`, `edge.status`, `machine.status` or log reads as receipts (for example Azure and ECS job status, Cloud Run, ECS, Kubernetes and Azure service status, Vercel edge status and logs); others return status, logs and file reads without one. Do not treat a missing read receipt as a missing read.
- `raw()` returns the native provider client and bypasses capability checks, policy, redaction and receipts entirely. Nothing done through it is recorded.
- A receipt is Capsule's observation of a call. It does not prove provider state, and a failed or interrupted operation may have provider effects without a receipt (see `PartialEffectsError`, `UnknownOutcomeError` and `PendingOperationError` in the errors reference).

The schema includes:

- receipt id
- `schemaVersion`: the receipt schema version, stamped as `capsule.receipt.v1` by `createReceipt`. It is optional so receipts written before versioning stay valid.
- `parentId`: optional id of a parent receipt, so chained operations can record receipt lineage.
- action type
- provider and adapter
- capability path and support level
- command, image, source, and cwd when relevant
- start, finish, and duration
- exit code
- SHA-256 hashes of stdout, stderr, and artifacts
- policy decision, applied policy, and notes, plus the decision `enforcement` mode and `trace`, and the `cost`, `ttl`, and `network` diagnostics when the policy declares them (see the Policy Model)
- resource id, name, URL, and status
- metadata
- optional signature fields

Receipt metadata uses these common provider fields when an adapter can observe them:

- `providerRequestId`: opaque provider control-plane request id for the API call Capsule observed. This is for correlation and support/debugging only; it must not contain credentials, bearer tokens, signed URLs, or other secrets.
- `providerApiVersion`: provider API surface version used by the adapter for the observed operation, when known. For providers with multiple APIs, this is operation-specific rather than package-wide.
- `providerRegion`: provider region or location that scoped the observed operation, when known.
- `runtimeVersion`: runtime version observed by the adapter. For SDK-backed adapters this is the local Node.js runtime; provider-specific runtime/version fields may still appear separately when the provider returns them.
- `adapterVersion`: published Capsule adapter package version that produced the receipt, when available.
- `idempotencyKey`: opaque idempotency key supplied to or observed from the provider request when the adapter can safely record it. Callers should generate non-secret keys and avoid embedding user data or credentials.
- `idempotencyScope`: provider-specific operation or resource scope where the idempotency key applies, such as `job.run` or a provider resource path.
- `operationTag`: deterministic non-secret hash derived from `idempotencyKey` plus scope. Adapters use this tag for provider labels/tags where those channels already exist, avoiding raw caller idempotency keys in provider-visible metadata.
- `sourceResourceId`: resource id this operation derived from, when the receipt records lineage from a source resource such as a branch created from a project.
- `parentResourceId`: resource id that owns or precedes the resource in this receipt, when the receipt records resource lineage.

Mutating operation specs accept `idempotencyKey`. Capsule attaches that key to receipts created through the operation-scoped adapter context, using the capability path as the default `idempotencyScope`, and derives `operationTag` for non-secret provider correlation. If an adapter also supplies idempotency metadata, the caller-provided operation key remains authoritative and other provider metadata is preserved.

Provider-visible operation tags use `capsule_operation_key` and `capsule_operation_scope` when an adapter already has a label/tag channel. The key is the deterministic hash, not the raw idempotency key. The scope value is normalized for provider label compatibility, for example `service.deploy` becomes `service_deploy`.

Adapters may include additional provider-specific metadata, but receipt creation redacts known secret-bearing metadata keys before signing or storing a receipt. Policies can add project-specific `secrets.redactKeys`, and the strict redaction profile masks common token-shaped values in receipt metadata and provider options. Adapters should still avoid placing secrets in metadata at all; redaction is a last boundary check, not a substitute for careful provider mapping.

For concrete sanitized shapes, see [`docs/live-receipt-samples/golden-live-receipts.json`](live-receipt-samples/golden-live-receipts.json). The samples are deterministic placeholders for documentation and future receipt-verifier work; they are not captured provider outputs.

Receipts created through Capsule's adapter context are operation-scoped. Capsule stamps the active provider and adapter, computes the support level from the declared capability path, and rejects mismatched receipt type/capability pairs for the active operation. For example, an adapter handling `service.delete` cannot persist a `job.run` receipt through the same context. Sandbox sub-operations are core-wrapped: `exec`, `writeFile`, `readFile`, `listFiles`, and `destroy` each run with their own policy and receipt scope. File read/write/list operations record core receipts with the sandbox id, path, and byte or entry counts. The Docker adapter has a non-live regression test covering the full wrapped sub-operation receipt sequence.

Receipts prove what Capsule observed. They do not prove absolute provider truth or complete runtime isolation.

Captured logs follow the same observational rule (ADR 0004): a receipt's `logs` are a best-effort bounded snapshot of what the adapter read at that moment, not a complete or guaranteed transcript of the run. See [log normalization](log-normalization.md) for the per-provider bounds.

Receipt signing is optional and disabled by default. `@capsule-sdk/core` exposes a small synchronous `ReceiptSigner` interface that receives the unsigned receipt plus a canonical JSON payload and returns a signature value plus algorithm/key metadata. The canonical payload sorts object keys, omits undefined values, and excludes the `signature` field. `canonicalReceiptPayload`, `unsignedReceipt`, and `verifyReceiptSignature` are exported so tests, CI systems, or future FIDES-style integrations can attach and verify deterministic signatures without adding a crypto dependency to core.

Signatures cover Capsule's unsigned receipt object before the `signature` field is attached. They are not provider attestations unless the caller's signer explicitly binds provider evidence.

`verifyReceipt(receipt, options)` checks the receipt shape, optional signature status, and obvious redaction failures without adding a JSON Schema dependency. It reports `missing`, `present-unverified`, `valid`, or `invalid` signature status. Use `requireSignature` when unsigned receipts should fail a local audit.

The CLI can verify a JSONL receipt store without executing provider actions:

```bash
capsule receipt verify --receipt-file .capsule/receipts.jsonl
capsule receipt verify --receipt-file .capsule/receipts.jsonl --public-key ./capsule-receipts.pub --require-signature
```

Pass `--public-key <path-or-value>` to authenticate signatures. The value is either a path to an ed25519 public key in PEM (SPKI) form or an inline PEM string. The CLI builds a `ReceiptVerifier` compatible with `verifyReceipt`, so a receipt whose signature does not verify against that key reports `invalid` and fails the run.

`--require-signature` fails any receipt that is not backed by a verified signature. Without `--public-key`, a receipt that merely carries a signature object reports `present-unverified`; under `--require-signature` that is a failure, because presence is not proof. Pass `--allow-unverified-signatures` to explicitly downgrade `--require-signature` to a presence-only check when no public key is available.

The CLI report includes store readability, receipt counts, schema errors, signature status, and redaction findings. Redaction findings name the unsafe field path and do not echo the unsafe value. An empty but readable store adds a `receipts: 0` note and stays exit 0, except under `--require-signature`, where verifying nothing is a failure.

Evidence bundles are explicit exports above individual receipts. `createEvidenceBundle` collects receipts, normalized logs, artifact metadata, policy decisions, and provider metadata into a `capsule.evidence.bundle.v1` object and adds a SHA-256 digest over the canonical bundle payload. `verifyEvidenceBundle` recomputes that digest to detect local bundle tampering. Bundle verification does not replace receipt signature verification or provider-native audit evidence.

Receipt persistence is explicit. `receiptPersistence: "best-effort"` is the default and keeps provider operations moving if an optional store write fails. Use `receiptPersistence: "required"` when the caller must know that every receipt created during a Capsule operation was accepted by the configured `receiptStore`; in required mode, Capsule rejects before adapter execution starts if no store is configured or the store `ready()` preflight fails. A later store `write()` failure still rejects after the adapter creates the receipt, so the provider side effect may already have happened before Capsule reports evidence loss. Evidence profiles that make destructive or billable operations transactional with evidence persistence are future work.

`@capsule-sdk/store-jsonl` is the local file store. Its writes create parent directories, append one receipt per line, serialize concurrent writes on one store instance, and flush by default before `write` resolves. `iterate()` reads receipts one line at a time without holding the file: only one 1 MiB read chunk and the current line stay in memory, and stopping early closes the file. `readAll()` collects the same reader into an array, reading 4 MiB chunks. Both read a file up to its size when the read started, skip blank lines, and report corrupt JSON with file and line context. A line longer than `maxLineBytes` (default 16 MiB, set on the store or per read) fails with its line number instead of growing memory. `capsule receipt verify` and `receipt inspect` stream the store the same way. `close()` waits for queued writes and rejects later operations.

`@capsule-sdk/store-sqlite` is an optional Node 24 local SQLite store. It persists the full receipt JSON plus indexed columns for provider, receipt type, capability path, support level, and timestamps. Each write is its own autocommitted `INSERT OR REPLACE`; the store prepares that statement and the `readAll` query once and reuses them. Reads report corrupt stored JSON with receipt id context, and a closed store rejects later operations with an explicit closed-store error. The package uses Node's built-in `node:sqlite` module, so it remains dependency-free but should be treated as a Node 24 local persistence adapter rather than a portable browser or edge store.

The receipt JSON Schema is published at [`schemas/capsule-receipt.schema.json`](../schemas/capsule-receipt.schema.json) and exported from `@capsule-sdk/core` as `capsuleReceiptJsonSchema`.
