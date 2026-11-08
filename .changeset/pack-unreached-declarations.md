---
"@capsule-sdk/mock": patch
"@capsule-sdk/core": patch
"@capsule-sdk/docker": patch
"@capsule-sdk/cli": patch
"@capsule-sdk/bridge-worker": patch
---

Stop packing declaration files the package's `types` entry never reaches, and declaration maps for core and docker, which pointed at sources the packages do not ship. What a consumer can import is unchanged.
