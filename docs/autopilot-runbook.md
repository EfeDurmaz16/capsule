# Autopilot Runbook

Capsule has two orchestration modes:

1. Symphony-compatible planning through `WORKFLOW.md`.
2. A GitHub-backed local autopilot runner in `scripts/capsule-autopilot.mjs`.

The second mode is practical when Linear is not configured. It reads open GitHub issues labeled `capsule` and `needs-verification`, creates one git worktree per issue, runs `codex exec`, and asks the agent to push a branch and open a PR.

## Start Overnight

```bash
git pull --ff-only
caffeinate -dimsu node scripts/capsule-autopilot.mjs --max-parallel 2
```

Dry run does not create labels, worktrees, or state files:

```bash
node scripts/capsule-autopilot.mjs --once --dry-run --max-parallel 2
```

For a detached run:

```bash
mkdir -p .symphony/logs
nohup caffeinate -dimsu node scripts/capsule-autopilot.mjs --max-parallel 2 > .symphony/logs/autopilot.log 2>&1 &
echo $! > .symphony/autopilot.pid
```

For a macOS LaunchAgent run that survives the shell closing:

```bash
mkdir -p ~/Library/LaunchAgents .symphony/logs
cp scripts/com.capsule.autopilot.plist.example ~/Library/LaunchAgents/com.capsule.autopilot.plist
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.capsule.autopilot.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.capsule.autopilot.plist
launchctl kickstart -k "gui/$(id -u)/com.capsule.autopilot"
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
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.capsule.autopilot.plist
```

## Safety

- The runner does not close issues automatically.
- The runner does not merge PRs automatically.
- The runner skips issues that already have an open `autopilot/issue-N` pull request.
- The runner skips issues labeled `autopilot-running`, `autopilot-failed`, `blocked`, or `needs-design`.
- `--dry-run` only prints eligible work; it does not create worktrees, labels, or lock state.
- Stale locks are recovered after `CAPSULE_AUTOPILOT_STALE_LOCK_MS` or `--stale-lock-ms`; the default is six hours.
- Each issue runs in a separate worktree under `.symphony/workspaces`.
- Live provider tests must still be explicitly gated with `CAPSULE_LIVE_TESTS=1`.
- If Linear is configured later, the same task graph can be mirrored there and the OpenAI Symphony reference implementation can poll Linear directly.
