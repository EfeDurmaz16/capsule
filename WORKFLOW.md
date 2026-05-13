---
tracker:
  kind: linear
  api_key: "$LINEAR_API_KEY"
  project_slug: "4a792bca0f93"
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Canceled
polling:
  interval_ms: 30000
workspace:
  root: ".symphony/workspaces"
hooks:
  after_create: |
    git status --short --branch
  before_run: |
    pnpm install --frozen-lockfile
  after_run: |
    pnpm capsule:gap || true
  timeout_ms: 120000
agent:
  max_concurrent_agents: 4
  max_turns: 20
  max_retry_backoff_ms: 300000
codex:
  command: "codex app-server"
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
---
# Capsule Symphony Workflow

You are working on Capsule, a TypeScript OSS control-plane SDK for runtime adapters.

Use the issue as the source of truth. Keep changes atomic and scoped. Before editing, run `git status --short --branch` and inspect nearby code. Do not overwrite unrelated user work.

Implementation rules:

- Keep public APIs TypeScript-first, ESM, strict, and minimally dependent.
- Never fake provider support. Unsupported or partial provider behavior must remain explicit in the capability map.
- Real provider tests must be skipped unless `CAPSULE_LIVE_TESTS=1` and the required credentials are present.
- Preserve mock adapters as contract/model fixtures, but do not use mocks to claim real provider completion.
- Add or update docs and examples with every user-visible capability change.
- Use focused tests for capability lookup, policy decisions, receipts, and adapter request mapping.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` when feasible before final handoff.
- Commit atomically with descriptive messages.

Issue context:

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- State: {{ issue.state }}
- Labels: {{ issue.labels }}
- Attempt: {{ attempt }}

Return a concise handoff with files changed, commits created, verification commands, and remaining risks.
