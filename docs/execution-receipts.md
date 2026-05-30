# Execution Receipts

Receipts record runtime actions across sandboxes, jobs, services, edge deployments, database branches, previews, and machines.

The schema includes:

- receipt id
- action type
- provider and adapter
- capability path and support level
- command, image, source, and cwd when relevant
- start, finish, and duration
- exit code
- SHA-256 hashes of stdout, stderr, and artifacts
- policy decision, applied policy, and notes
- resource id, name, URL, and status
- metadata
- optional signature fields

Receipt metadata uses these common provider fields when an adapter can observe them:

- `providerRequestId`: opaque provider control-plane request id for the API call Capsule observed. This is for correlation and support/debugging only; it must not contain credentials, bearer tokens, signed URLs, or other secrets.
- `idempotencyKey`: opaque idempotency key supplied to or observed from the provider request when the adapter can safely record it. Callers should generate non-secret keys and avoid embedding user data or credentials.
- `idempotencyScope`: provider-specific operation or resource scope where the idempotency key applies, such as `job.run` or a provider resource path.
- `operationTag`: deterministic non-secret hash derived from `idempotencyKey` plus scope. Adapters use this tag for provider labels/tags where those channels already exist, avoiding raw caller idempotency keys in provider-visible metadata.

Mutating operation specs accept `idempotencyKey`. Capsule attaches that key to receipts created through the operation-scoped adapter context, using the capability path as the default `idempotencyScope`, and derives `operationTag` for non-secret provider correlation. If an adapter also supplies idempotency metadata, the caller-provided operation key remains authoritative and other provider metadata is preserved.

Provider-visible operation tags use `capsule_operation_key` and `capsule_operation_scope` when an adapter already has a label/tag channel. The key is the deterministic hash, not the raw idempotency key. The scope value is normalized for provider label compatibility, for example `service.deploy` becomes `service_deploy`.

Adapters may include additional provider-specific metadata, but receipt creation redacts known secret-bearing metadata keys before signing or storing a receipt. Policies can add project-specific `secrets.redactKeys`, and the strict redaction profile masks common token-shaped values in receipt metadata and provider options. Adapters should still avoid placing secrets in metadata at all; redaction is a last boundary check, not a substitute for careful provider mapping.

Receipts created through Capsule's adapter context are operation-scoped. Capsule stamps the active provider and adapter, computes the support level from the declared capability path, and rejects mismatched receipt type/capability pairs for the active operation. For example, an adapter handling `service.delete` cannot persist a `job.run` receipt through the same context. Sandbox sub-operations are core-wrapped: `exec`, `writeFile`, `readFile`, `listFiles`, and `destroy` each run with their own policy and receipt scope. File read/write/list operations record core receipts with the sandbox id, path, and byte or entry counts. The Docker adapter has a non-live regression test covering the full wrapped sub-operation receipt sequence.

Receipts prove what Capsule observed. They do not prove absolute provider truth or complete runtime isolation.

Receipt signing is optional and disabled by default. `@capsule/core` exposes a small synchronous `ReceiptSigner` interface that receives the unsigned receipt plus a canonical JSON payload and returns a signature value plus algorithm/key metadata. The canonical payload sorts object keys, omits undefined values, and excludes the `signature` field. `canonicalReceiptPayload`, `unsignedReceipt`, and `verifyReceiptSignature` are exported so tests, CI systems, or future FIDES-style integrations can attach and verify deterministic signatures without adding a crypto dependency to core.

Signatures cover Capsule's unsigned receipt object before the `signature` field is attached. They are not provider attestations unless the caller's signer explicitly binds provider evidence.

Evidence bundles are explicit exports above individual receipts. `createEvidenceBundle` collects receipts, normalized logs, artifact metadata, policy decisions, and provider metadata into a `capsule.evidence.bundle.v1` object and adds a SHA-256 digest over the canonical bundle payload. `verifyEvidenceBundle` recomputes that digest to detect local bundle tampering. Bundle verification does not replace receipt signature verification or provider-native audit evidence.

Receipt persistence is explicit. `receiptPersistence: "best-effort"` is the default and keeps provider operations moving if an optional store write fails. Use `receiptPersistence: "required"` when the caller must know that every receipt created during a Capsule operation was accepted by the configured `receiptStore`; in required mode, Capsule rejects before adapter execution starts if no store is configured or the store `ready()` preflight fails. A later store `write()` failure still rejects after the adapter creates the receipt, so the provider side effect may already have happened before Capsule reports evidence loss. Evidence profiles that make destructive or billable operations transactional with evidence persistence are future work.

`@capsule/store-jsonl` is the local file store. Its writes create parent directories, append one receipt per line, serialize concurrent writes on one store instance, and flush by default before `write` resolves. `readAll()` reports corrupt JSON with file and line context. `close()` waits for queued writes and rejects later operations.

`@capsule/store-sqlite` is an optional Node 24 local SQLite store. It persists the full receipt JSON plus indexed columns for provider, receipt type, capability path, support level, and timestamps. Reads report corrupt stored JSON with receipt id context, and a closed store rejects later operations with an explicit closed-store error. The package uses Node's built-in `node:sqlite` module, so it remains dependency-free but should be treated as a Node 24 local persistence adapter rather than a portable browser or edge store.

The receipt JSON Schema is published at [`schemas/capsule-receipt.schema.json`](../schemas/capsule-receipt.schema.json) and exported from `@capsule/core` as `capsuleReceiptJsonSchema`.
