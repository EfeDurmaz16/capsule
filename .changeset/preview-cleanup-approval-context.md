---
"@capsule-sdk/core": minor
"@capsule-sdk/preview": patch
---

Let a cleanup approval resolver tell same-id resources apart.

`CleanupApprovalRequest` gains an optional `context` with the resource provider, the adapter name of the Capsule that runs the cleanup, the graph-local `resourceRef`, the cleanup `actionId`, the `previewId` and the provider `scope` (for example the database project). Preview cleanup fills it for every request, so two services named `web` in different namespaces or on different providers no longer produce identical requests. The request `resource` and the approval hint Capsule core evaluates for `service.delete` and `database.branchDelete` now both carry the adapter `provider`, so a grant scoped to one provider matches only that provider's resource. A grant scoped without `provider` matches as before.
