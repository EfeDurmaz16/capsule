---
"@capsule-sdk/cli": patch
---

Reject wrongly typed config values and unknown policy fields instead of dropping them.

A `capsule.config.json` whose `adapter` or `policyFile` is present but not a string (an array, an object or `null`), or whose `receipts` block has a wrongly typed `enabled` or `path`, now fails before any provider is created. Before, such a value was ignored, so the command ran on the Docker default with no policy. A `capsule.config.json` that exists but cannot be read (for example a permission error or a directory) now fails too; only a missing file means "no config". A policy file now also rejects unknown fields inside a known section (for example `approvals.requried`), wrongly typed field values and an unknown `secrets.redactionProfile`, since policy evaluation reads fields by exact name and would otherwise skip the restriction.
