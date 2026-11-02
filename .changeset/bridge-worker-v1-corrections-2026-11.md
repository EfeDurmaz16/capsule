---
"@capsule-sdk/bridge-worker": patch
---

Bridge protocol v1 corrections of 2026-11-03, with their shared fixtures. A request target or observe resource without a `native_id` (absent, null or empty) is `invalid`/`missing_field` instead of `bad_locator`, and an approval grant with an empty `native_id` is refused at config time. Both profiles advertise `max_timeout_ms` (fixture 60000 ms, docker 3600000 ms) and refuse an exec `timeout_ms` above it as `invalid`/`limit`. An observe of a create or a destroy whose one read finds no resource in the bound scope answers `unknown`/`absent` with the scope it searched (it answered `not_found` for a create and `completed`/`destroyed` for a destroy); a destroy the provider answers `not_found` stays a bare `not_found`, and `searched` is accepted only on `unknown`/`absent`. Fabric settles a `not_found` destroy on the absent answer to its observe, and the worker keeps no ledger of earlier reads.
