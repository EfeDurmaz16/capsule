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

Adapters may include additional provider-specific metadata, but receipt creation redacts known secret-bearing metadata keys before signing or storing a receipt. Adapters should still avoid placing secrets in metadata at all; redaction is a last boundary check, not a substitute for careful provider mapping.

Receipts prove what Capsule observed. They do not prove absolute provider truth or complete runtime isolation.

Receipt signing is optional and disabled by default. `@capsule/core` exposes a small synchronous `ReceiptSigner` interface that receives the unsigned receipt and returns a signature value plus algorithm/key metadata. This keeps v1 dependency-free while allowing tests, CI systems, or future FIDES-style integrations to attach deterministic signatures.

Signatures cover Capsule's receipt object before the `signature` field is attached. They are not provider attestations unless the caller's signer explicitly binds provider evidence.

Receipt persistence is explicit. `receiptPersistence: "best-effort"` is the default and keeps provider operations moving if an optional store write fails. Use `receiptPersistence: "required"` when the caller must know that every receipt created during a Capsule operation was durably accepted by the configured `receiptStore`; in required mode, a missing store or failed store write rejects the Capsule operation instead of returning a result with uncertain evidence.

`@capsule/store-jsonl` is the local file store. Its writes create parent directories, append one receipt per line, and flush by default before `write` resolves. It is intentionally an optional package, not a core database.

`@capsule/store-sqlite` is an optional Node 24 local SQLite store. It persists the full receipt JSON plus indexed columns for provider, receipt type, capability path, support level, and timestamps. The package uses Node's built-in `node:sqlite` module, so it remains dependency-free but should be treated as a Node 24 local persistence adapter rather than a portable browser or edge store.

The receipt JSON Schema is published at [`schemas/capsule-receipt.schema.json`](../schemas/capsule-receipt.schema.json) and exported from `@capsule/core` as `capsuleReceiptJsonSchema`.
