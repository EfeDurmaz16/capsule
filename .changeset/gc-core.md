---
"@capsule-sdk/core": minor
---

Add crash-safe cleanup. `new Capsule({ owner: { job } })` labels every create with `capsule_operation` (new per create) and `capsule_job`. `capsule.gc.scan({ liveness })` lists labelled resources from an adapter's new optional `residuals.list()` and splits them into residuals (owner `ended` or `exited`) and kept (`live` or `unknown`). `capsule.gc.remove({ liveness, approve })` removes residual sandboxes: each removal needs its own fresh grant scoped to `sandbox.destroy` and that resource (a grant that also allows a create is refused), writes a `sandbox.destroy` receipt, and counts as removed only when a second scan no longer lists it. `JobLeases` keeps per-job leases on disk and proves liveness from them; `liveSet` builds one from sets the caller holds. `consentApprovals` turns a person's confirmation of the listed resources into one such grant each, and `withJobLease` runs work under a lease so a crash leaves it for gc.
