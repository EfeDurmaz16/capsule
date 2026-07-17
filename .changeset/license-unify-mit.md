---
"@capsule-sdk/core": patch
"@capsule-sdk/cli": patch
"@capsule-sdk/ai": patch
"@capsule-sdk/presets": patch
"@capsule-sdk/preview": patch
"@capsule-sdk/store-jsonl": patch
"@capsule-sdk/store-sqlite": patch
"@capsule-sdk/adapter-docker": patch
"@capsule-sdk/adapter-e2b": patch
"@capsule-sdk/adapter-daytona": patch
"@capsule-sdk/adapter-modal": patch
"@capsule-sdk/adapter-cloudflare": patch
"@capsule-sdk/adapter-cloud-run": patch
"@capsule-sdk/adapter-kubernetes": patch
"@capsule-sdk/adapter-lambda": patch
"@capsule-sdk/adapter-ecs": patch
"@capsule-sdk/adapter-ec2": patch
"@capsule-sdk/adapter-fly": patch
"@capsule-sdk/adapter-azure-container-apps": patch
"@capsule-sdk/adapter-neon": patch
"@capsule-sdk/adapter-mock": patch
---

License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
