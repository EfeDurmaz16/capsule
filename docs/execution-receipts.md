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

Receipts prove what Capsule observed. They do not prove absolute provider truth or complete runtime isolation.

Receipt signing is optional and disabled by default. `@capsule/core` exposes a small synchronous `ReceiptSigner` interface that receives the unsigned receipt and returns a signature value plus algorithm/key metadata. This keeps v1 dependency-free while allowing tests, CI systems, or future FIDES-style integrations to attach deterministic signatures.

Signatures cover Capsule's receipt object before the `signature` field is attached. They are not provider attestations unless the caller's signer explicitly binds provider evidence.

The receipt JSON Schema is published at [`schemas/capsule-receipt.schema.json`](../schemas/capsule-receipt.schema.json) and exported from `@capsule/core` as `capsuleReceiptJsonSchema`.
