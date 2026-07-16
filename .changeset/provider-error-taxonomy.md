---
"@capsule/core": minor
"@capsule/adapter-docker": patch
"@capsule/adapter-kubernetes": patch
"@capsule/adapter-lambda": patch
"@capsule/adapter-ec2": patch
"@capsule/adapter-ecs": patch
"@capsule/adapter-e2b": patch
"@capsule/adapter-daytona": patch
"@capsule/adapter-modal": patch
"@capsule/adapter-mock": patch
"@capsule/adapter-azure-container-apps": patch
---

Adopt the provider error taxonomy across every adapter. Core adds `classifySdkError`, `asProviderError`, and `callProvider` so SDK-based adapters normalize provider error shapes (status codes, error names/codes) into the shared retryable/rate-limit/auth/validation categories. The docker, kubernetes, lambda, ec2, ecs, e2b, daytona, modal, and mock adapters now attach `cause.providerError` on failures instead of throwing raw errors, so callers get the same typed categories the six HTTP adapters already emitted. Docker classifies conservatively from CLI exit codes and stderr signals. Each adapter contract test now exercises the shared failure-scenario harness with a real scenario, and the Azure Container Apps client gains explicit classification tests.
