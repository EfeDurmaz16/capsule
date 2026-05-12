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
- future signature fields

Receipts prove what Capsule observed. They do not prove absolute provider truth or complete runtime isolation.

Future signing can add FIDES-style attestations, key IDs, and tamper-evident logs without changing the core contract.
