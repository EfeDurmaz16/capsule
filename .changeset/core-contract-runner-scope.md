---
"@capsule-sdk/core": patch
---

Document that `runAdapterContract` and `runCapsuleAdapterContract` are guard-only checks: they verify declarations, unsupported-capability errors, approval fail-closed behavior and supplied failure scenarios, but do not run a successful lifecycle. The `adapterContractFixtures.lifecycle` note no longer claims the lifecycle is exercised end to end; it states the fixture is descriptive data for adapter tests.
