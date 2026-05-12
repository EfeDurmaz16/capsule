# Comparison

## files-sdk

files-sdk is a clean adapter layer for file storage. Capsule borrows the adapter discipline, but compute and deployment domains are more fragmented and security-sensitive.

## ComputeSDK

ComputeSDK-style abstractions often focus on running code. Capsule covers adjacent runtime domains and makes capability support explicit.

## E2B, Daytona, Modal

These are providers or runtime platforms. Capsule can adapt to them; it does not replace them.

## Dagger

Dagger is a programmable CI/CD engine. Capsule is a runtime adapter/spec layer that can be used by CI systems but is not a pipeline engine.

## Nitric And Encore

Nitric and Encore provide application frameworks and cloud abstractions. Capsule is not an application framework and does not own app architecture.

## Terraform And Pulumi

Terraform and Pulumi manage infrastructure state. Capsule focuses on runtime actions, previews, receipts, policy, and adapter-level execution/deployment primitives.

## Vercel And Cloudflare SDKs

Provider SDKs expose provider APIs. Capsule wraps domain contracts around multiple providers while preserving support levels and escape hatches.
