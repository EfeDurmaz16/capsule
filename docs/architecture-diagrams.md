# Architecture Diagrams

These diagrams are source-of-truth documentation. Update them when the core facade, adapter boundary, policy path, receipt stores, or live-test workflow changes.

## Governed Operation Path

```mermaid
flowchart LR
  caller[Caller or agent tool]
  capsule[Capsule facade]
  capability[Capability check]
  policy[Policy evaluation]
  adapter[Adapter operation]
  provider[Provider API or runtime]
  receipt[Operation receipt]
  store[Optional receipt store]

  caller --> capsule
  capsule --> capability
  capability -->|unsupported| denied[UnsupportedCapabilityError]
  capability -->|supported| policy
  policy -->|denied| violation[PolicyViolationError]
  policy -->|allowed| adapter
  adapter --> provider
  provider --> adapter
  adapter --> receipt
  receipt --> store
  adapter --> caller
```

## Package Boundary

```mermaid
flowchart TB
  core["@capsule/core\nfacade, types, policy, receipts"]
  cli["@capsule/cli\ninspection and local workflows"]
  ai["@capsule/ai\nframework tool helpers"]
  presets["@capsule/presets\nspec and policy factories"]
  preview["@capsule/preview\nmulti-resource orchestration"]
  stores["@capsule/store-jsonl\n@capsule/store-sqlite"]
  adapters["provider adapters\nDocker, E2B, Daytona, Modal,\nCloud Run, Kubernetes, ECS, Fly,\nAzure, Cloudflare, Vercel,\nLambda, Neon, EC2"]
  providers["provider APIs and runtimes"]

  cli --> core
  ai --> core
  presets --> core
  preview --> core
  core --> adapters
  adapters --> providers
  core --> stores
```

## Policy And Receipt Scope

```mermaid
sequenceDiagram
  participant User
  participant Capsule
  participant Adapter
  participant Store

  User->>Capsule: mutating operation spec
  Capsule->>Capsule: require declared capability
  Capsule->>Capsule: evaluate env, timeout, TTL, approval, redaction policy
  Capsule->>Store: required mode preflight
  Capsule->>Adapter: operation with scoped context
  Adapter->>Capsule: context.createReceipt(...)
  Capsule->>Capsule: verify receipt type and capability path scope
  Capsule->>Capsule: redact metadata and provider options
  Capsule->>Store: write receipt
  Capsule-->>User: result with receipt when supported
```

## Receipt Store Modes

```mermaid
flowchart LR
  operation[Operation]
  memory[In-memory result receipt]
  bestEffort[Best-effort store write]
  required[Required store mode]
  ready[receiptStore.ready]
  provider[Provider side effect]
  write[receiptStore.write]

  operation --> memory
  operation --> bestEffort
  bestEffort --> provider
  bestEffort --> write

  operation --> required
  required --> ready
  ready --> provider
  provider --> write
  write --> result[operation resolves or rejects on durability failure]
```

## Live Test Gate

```mermaid
flowchart TB
  developer[Developer]
  planner[capsule live-test plan]
  env[Credential and flag check]
  skip[Skip with explicit reason]
  live[Provider live test]
  receipt[Sanitized live receipt]
  cleanup[Provider cleanup or documented manual cleanup]

  developer --> planner
  planner --> env
  env -->|missing CAPSULE_LIVE_TESTS or credentials| skip
  env -->|explicit opt-in| live
  live --> receipt
  live --> cleanup
```

## Raw Escape Hatch Boundary

```mermaid
flowchart LR
  caller[Caller]
  raw[capsule.raw]
  provider[Provider-native client or metadata]
  governed[Capsule governed facade]

  caller --> raw --> provider
  caller --> governed
  governed --> checks[capability, policy, receipts, redaction]
  checks --> provider
```

`raw()` is intentionally outside the governed path. Use it for provider-native inspection or setup, not for audited execution.
