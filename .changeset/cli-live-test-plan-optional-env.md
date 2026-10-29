---
"@capsule-sdk/cli": patch
---

`capsule live-test plan` and `live-test validate` now list the optional switches that the live suites already read: `CAPSULE_CLOUD_RUN_JOB_IMAGE` for the billable Cloud Run job smoke, and `CAPSULE_CLOUDFLARE_LIVE_DEPLOY` and `CAPSULE_CLOUDFLARE_LIVE_ROLLBACK` for the Cloudflare deploy and rollback smokes. The plans also say that the dispatched live workflow does not set these switches. Required env, cost gates and commands are unchanged. A parity test now keeps the CLI plan, `scripts/live-test-matrix.mjs`, the `@capsule-sdk/test-utils` gates and the workflow secret mapping in step.
