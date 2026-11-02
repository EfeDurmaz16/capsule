---
"@capsule-sdk/preview": minor
"@capsule-sdk/presets": patch
---

Preview TTL is now labeled for what it is. `PreviewPlan.ttlMs` is recorded as `ttl: { requestedMs, enforcement: "record-only" }` in the dry-run and `preview.create` receipt metadata; the package has no expiry controller and does not pass the value to child resources. New `PreviewPlan.ttlEnforcement: "required"` rejects creation with `UnsupportedCapabilityError` (`preview.ttl`) before any provider call. Preset notes and catalog descriptions no longer imply provider-side expiry for Neon branches or composed previews.
