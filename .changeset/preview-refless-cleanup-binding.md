---
"@capsule-sdk/preview": patch
---

Clean up ref-less resource records that share a native id again.

`cleanupPreviewEnvironment(preview, records)` without a `cleanupPlan`, or with a plan made by `createPreviewCleanupPlan` from the same records, threw `PreviewCleanupPlanError` ("ambiguous") when two records without `ref` had the same kind, provider and id, for example two Kubernetes services named `web` in different namespaces. A ref-less record now binds first to the action the plan generated for its own position, and each record is deleted through its own Capsule. Legacy plans whose actions carry no `resourceRef` still bind only by an unambiguous identity match.
