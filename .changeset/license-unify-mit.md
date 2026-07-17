---
"@capsule-sdk/core": patch
"@capsule-sdk/cli": patch
"@capsule-sdk/ai": patch
"@capsule-sdk/presets": patch
"@capsule-sdk/preview": patch
"@capsule-sdk/store-jsonl": patch
"@capsule-sdk/store-sqlite": patch
"@capsule-sdk/docker": patch
"@capsule-sdk/e2b": patch
"@capsule-sdk/daytona": patch
"@capsule-sdk/modal": patch
"@capsule-sdk/cloudflare": patch
"@capsule-sdk/cloud-run": patch
"@capsule-sdk/kubernetes": patch
"@capsule-sdk/lambda": patch
"@capsule-sdk/ecs": patch
"@capsule-sdk/ec2": patch
"@capsule-sdk/fly": patch
"@capsule-sdk/azure": patch
"@capsule-sdk/neon": patch
"@capsule-sdk/mock": patch
---

License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
