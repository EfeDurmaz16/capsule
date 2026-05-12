# Symphony Harness

Capsule can use Symphony as an operations layer around the repository. Symphony should not become part of the public SDK surface; it is a maintainer harness for turning the roadmap into isolated implementation runs.

Symphony's public spec describes a long-running service that polls an issue tracker, creates a per-issue workspace, runs a coding agent, tracks retries, and loads behavior from a repository-owned `WORKFLOW.md`. The reference repository currently emphasizes Linear-backed work dispatch, bounded concurrency, workspace isolation, structured logs, and optional dashboard/API observability.

References:

- <https://github.com/openai/symphony>
- <https://github.com/openai/symphony/blob/main/SPEC.md>
- <https://github.com/openai/symphony/blob/main/elixir/README.md>

## Capsule Shape

Capsule's Symphony layer has four files:

- `WORKFLOW.md`: the repo-owned Symphony contract and per-issue agent prompt.
- `.capsule/tasks.json`: the local v1/v2 task graph.
- `scripts/capsule-gap-report.mjs`: a repo scanner that reports capability gaps and mock-first examples.
- `scripts/create-github-issues.mjs`: a safe issue generator. By default it prints issue payloads and commands. It only calls `gh issue create` with `--apply`.
- `.github/workflows/ci.yml`: CI proof for typecheck, tests, build, and the gap report.
- `.github/ISSUE_TEMPLATE/capsule-task.yml`: a structured issue template that matches the task graph.

GitHub Issues can be used as the durable task ledger. Linear can mirror the same task graph when `LINEAR_API_KEY` and a project slug are available. The current repository scaffold avoids publishing either until an operator chooses to run the publish step.

## Dispatch Model

1. A maintainer updates `.capsule/tasks.json` or imports tasks into GitHub/Linear.
2. Symphony polls issues in active states.
3. Each issue gets its own workspace under `.symphony/workspaces`.
4. The coding agent reads `WORKFLOW.md`, implements one issue, verifies it, and commits atomically.
5. The issue moves to a review/handoff state with proof: tests, build status, changed files, and risks.
6. The loop continues until there are no eligible v1/v2 issues left.

## What Remains For Capsule

The repository has real adapters for Docker, E2B, Daytona, Modal, Neon, Cloudflare Workers, Cloud Run, Vercel, Kubernetes, Lambda, ECS/Fargate, and EC2. The remaining work is not "replace every mock"; the remaining work is to close lifecycle gaps honestly:

- deeper service/job lifecycle operations: status, logs, cancel, delete, rollback, aliases/routes, and teardown;
- live integration tests behind explicit credential gates;
- real preview environment composition across multiple adapters;
- reusable adapter contract tests for provider authors;
- mock-first examples upgraded to env-gated real-adapter examples;
- release automation, publishing metadata, and CI;
- extra roadmap adapters such as Fly Machines and Azure Container Apps;
- stronger policy notes, secret redaction coverage, and receipt evidence tests.

## Guardrails

- Keep `max_concurrent_agents` bounded. Four is enough for this repo until CI is faster.
- Do not run live provider tests unless `CAPSULE_LIVE_TESTS=1`.
- Do not create or destroy cloud resources outside disposable test projects/accounts.
- Do not log provider tokens, private keys, secrets, or connection strings.
- Treat GitHub/Linear issue creation as an explicit publish step.
- Prefer PR/review handoff over auto-landing until the harness has proven itself on low-risk issues.

## Local Commands

```bash
pnpm capsule:gap
pnpm capsule:issues
pnpm capsule:issues -- --apply
```

The final command creates GitHub issues through `gh issue create`; use it only after reviewing the generated task list.

Without Linear, use the GitHub-backed runner:

```bash
pnpm capsule:autopilot -- --max-parallel 2
```

For an overnight run, wrap it in `caffeinate` so macOS does not sleep while agents are running.
