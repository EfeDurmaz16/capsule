# Database Resource Model

Database resources are deployment-adjacent runtime state. Neon branches are the first model: create a branch from a parent, expose a connection string, optionally run migrations, reset, snapshot, restore, delete, and emit a resource receipt.

Preview environments often need temporary database branches. Capsule should make branch TTL, cleanup, migration logs, connection string handling, and receipts explicit.

Connection strings are sensitive. Adapters should avoid logging them, and examples should print them only when explicitly safe or fake.
