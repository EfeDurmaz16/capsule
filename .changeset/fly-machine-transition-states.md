---
"@capsule-sdk/fly": minor
---

Machine status follows the documented Fly Machine states instead of reporting `failed` for normal transitions. `creating` maps to `creating`; `starting`, `restarting`, `updating` and `replacing` map to `starting`; `stopping` and `suspending` map to `stopping`; `destroying` maps to `destroying`; `launch_failed` maps to `failed`. The native state stays in `metadata.state`. An unrecognized native state now throws from `machine.status` instead of being reported as `failed`.

`machine.start` and `machine.stop` read the real acknowledgement bodies (`{ previous_state }` and `{ ok }`) and report `starting` and `stopping`; a status read confirms the stable state. An empty success body no longer throws a TypeError.
