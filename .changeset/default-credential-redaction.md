---
"@capsule-sdk/core": minor
"@capsule-sdk/cli": patch
"@capsule-sdk/adapter-azure-container-apps": patch
---

Credential-shaped tokens (Bearer values, provider key prefixes, JWTs) are now redacted from Capsule-observed logs, receipts, and errors on every redaction profile, not only under `redactionProfile: "strict"`; matching is case-insensitive to stay consistent with `verifyReceipt`. The strict profile still adds the broad long-token catch-all. `capsule doctor` now reports Node versions below 22 as unsupported, matching the declared engines floor. The Azure Container Apps adapter reads HTTP status from the provider error classification as a fallback when detecting missing jobs.
