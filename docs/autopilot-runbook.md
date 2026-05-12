# Autopilot Runbook

Capsule has two orchestration modes:

1. Symphony-compatible planning through `WORKFLOW.md`.
2. A GitHub-backed local autopilot runner in `scripts/capsule-autopilot.mjs`.

The second mode is practical when Linear is not configured. It reads open GitHub issues labeled `capsule` and `needs-verification`, creates one git worktree per issue, runs `codex exec`, and asks the agent to push a branch and open a PR.

## Start Overnight

```bash
git pull --ff-only
caffeinate -dimsu pnpm capsule:autopilot -- --max-parallel 2
```

For a detached run:

```bash
mkdir -p .symphony/logs
nohup caffeinate -dimsu pnpm capsule:autopilot -- --max-parallel 2 > .symphony/logs/autopilot.log 2>&1 &
echo $! > .symphony/autopilot.pid
```

## Check Status

```bash
cat .symphony/autopilot-state.json
tail -f .symphony/logs/autopilot.log
gh issue list --label capsule --limit 20
gh pr list --limit 20
```

## Stop

```bash
kill "$(cat .symphony/autopilot.pid)"
```

## Safety

- The runner does not close issues automatically.
- The runner does not merge PRs automatically.
- Each issue runs in a separate worktree under `.symphony/workspaces`.
- Live provider tests must still be explicitly gated with `CAPSULE_LIVE_TESTS=1`.
- If Linear is configured later, the same task graph can be mirrored there and the OpenAI Symphony reference implementation can poll Linear directly.
