---
"@capsule-sdk/cli": patch
---

Keep recovery bindings when `capsule preview create` fails part-way.

When creation fails after some resources exist, the CLI now writes their cleanup bindings, and any residual locator from the failed step, to `--cleanup-file` before it rethrows, so `capsule preview destroy --cleanup-file <file>` can remove them. Without `--cleanup-file` the same bindings are printed to stderr. Before, nothing was written or printed and the created resources could only be found in the error message. Cleanup files now also carry an optional `residual` field per resource, which `preview destroy` validates and reports as leaked when no cleanup action exists for it.
