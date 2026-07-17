---
"@capsule/core": patch
"@capsule/cli": patch
"@capsule/ai": patch
"@capsule/presets": patch
"@capsule/preview": patch
"@capsule/store-jsonl": patch
"@capsule/store-sqlite": patch
"@capsule/adapter-docker": patch
"@capsule/adapter-e2b": patch
"@capsule/adapter-daytona": patch
"@capsule/adapter-modal": patch
"@capsule/adapter-cloudflare": patch
"@capsule/adapter-cloud-run": patch
"@capsule/adapter-kubernetes": patch
"@capsule/adapter-lambda": patch
"@capsule/adapter-ecs": patch
"@capsule/adapter-ec2": patch
"@capsule/adapter-fly": patch
"@capsule/adapter-azure-container-apps": patch
"@capsule/adapter-neon": patch
"@capsule/adapter-mock": patch
---

License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
