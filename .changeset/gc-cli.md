---
"@capsule-sdk/cli": minor
---

Add `capsule gc`. On Docker, `run` and `sandbox` now write a job lease before the first provider call and label what they create, so a run killed mid-create leaves a residual that `capsule gc` reports (`--dry-run`) and removes after consent (`--yes` without a terminal), one fresh grant and one receipt per removal. Leases live in `CAPSULE_STATE_DIR/jobs`, then `XDG_STATE_HOME/capsule/jobs`, then `~/.local/state/capsule/jobs`.
