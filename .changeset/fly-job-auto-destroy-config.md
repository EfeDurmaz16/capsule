---
"@capsule-sdk/fly": patch
---

`job.run` now sends `auto_destroy` inside the Machine `config`, where the Fly Machines API reads it, instead of as an ignored top-level field. Ordinary `machine.create` still does not request auto-destroy.
