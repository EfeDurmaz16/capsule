---
"@capsule-sdk/core": minor
---

Add `Capsule.sandbox.attach({ id })` and the optional `SandboxAdapter.attach`. Attaching wraps an existing sandbox so exec, file access and destroy on it are governed like operations on a created sandbox: policy, fresh approvals and receipts apply per operation. Attaching itself changes no provider state, evaluates no policy and writes no receipt, and it carries no captured create grant, so destroy needs its own approval where policy requires one. An adapter without `attach` fails with `UnsupportedCapabilityError` before any provider call.
