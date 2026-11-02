---
"@capsule-sdk/bridge-worker": patch
---

Bridge protocol v1 corrections of 2026-11-03, with their shared fixtures. A request target or observe resource without a `native_id` (absent, null or empty) is `invalid`/`missing_field` instead of `bad_locator`, and an approval grant with an empty `native_id` is refused at config time. Both profiles advertise `max_timeout_ms` (fixture 60000 ms, docker 3600000 ms) and refuse an exec `timeout_ms` above it as `invalid`/`limit`. An observe that reads a resource as absent answers `not_found` with the scope it searched, and a destroy answered `not_found` carries the scope of the last absent observe of its target, so Fabric can settle it; `searched` is accepted on `provider_failed`/`not_found` and still refused on every other non-absent error.
