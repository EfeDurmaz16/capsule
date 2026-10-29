---
"@capsule-sdk/docker": minor
---

Implement `sandbox.attach` for Docker: it inspects the container (a read only) and returns a sandbox handle for that container id, so later exec and destroy go through Capsule policy and receipts. Add a `pull` adapter option passed to `docker create --pull`; `pull: "never"` makes a create fail when the image is not present locally instead of contacting a registry. Without the option the create arguments are unchanged.
