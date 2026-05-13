# Security Policy

Capsule is not a sandbox, cloud provider, or security boundary by itself. Isolation depends on the selected adapter and provider.

## Reporting

Please report vulnerabilities privately through GitHub security advisories when available, or by opening a minimal public issue that avoids exploit details and secrets.

Never include provider tokens, private keys, connection strings, account IDs that should remain private, or live exploit payloads in public issues.

## Scope

Security-relevant areas include:

- policy bypasses;
- secret leakage in logs, receipts, errors, examples, or CLI output;
- unsafe live-test behavior;
- receipt integrity bugs;
- provider credential handling;
- adapter behavior that overstates isolation or policy enforcement.

## Expectations

Adapters must describe whether enforcement is native, delegated, emulated, best-effort, experimental, or unsupported. Docker local execution should not be presented as safe for hostile untrusted code without additional host hardening.

