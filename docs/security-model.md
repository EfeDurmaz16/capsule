# Security Model

Capsule is not a sandbox by itself.

Isolation depends on the provider and the adapter. Docker local is not safe for hostile untrusted code unless configured carefully with host hardening, container isolation, seccomp/AppArmor, user namespaces, network controls, filesystem controls, and resource limits outside the basic adapter path.

Policy support may be native, emulated, unsupported, or experimental. Capsule records policy decisions and notes, but it must not claim full enforcement when enforcement is delegated, partial, or missing.

Receipts are observational records. They record what Capsule requested and observed, including hashes and resource metadata. They are not a cryptographic proof of the entire provider environment unless future signing and provider attestations are added.

Secrets must be handled carefully. Avoid logging raw credentials, private keys, tokens, connection strings, or payment data. Use allowlists and redaction. Provider docs and runtime isolation guarantees still matter.
