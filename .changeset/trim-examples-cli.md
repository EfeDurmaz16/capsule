---
"@capsule-sdk/cli": patch
---

Trim five trivial single-call example packages (`deployment-model`, `edge-model`, `database-branch-model`, `machine-model`, `job-docker`) whose API calls are already shown in the README Domains section, and drop them from the changesets ignore list, root `tsconfig.json` references, and CLI example classification.

Migrate the CLI argument parser to `node:util` `parseArgs` (non-strict token mode). Every flag and behavior is preserved: single-value flags, repeatable `--domain`/`--route`/`--subnet`/`--security-group`, boolean flags, numeric `--port`, and unknown tokens still falling through into `rest` in their original order.
