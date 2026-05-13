#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const stateDir = join(root, ".symphony");
const workspacesDir = join(stateDir, "workspaces");
const logsDir = join(stateDir, "logs");
const statePath = join(stateDir, "autopilot-state.json");

const args = new Set(process.argv.slice(2));
const maxParallel = Number(valueAfter("--max-parallel") ?? process.env.CAPSULE_AUTOPILOT_MAX_PARALLEL ?? "2");
const once = args.has("--once");
const dryRun = args.has("--dry-run");
const pollMs = Number(valueAfter("--poll-ms") ?? process.env.CAPSULE_AUTOPILOT_POLL_MS ?? "60000");
const staleLockMs = Number(valueAfter("--stale-lock-ms") ?? process.env.CAPSULE_AUTOPILOT_STALE_LOCK_MS ?? String(6 * 60 * 60 * 1000));
const repo = valueAfter("--repo") ?? process.env.GH_REPO ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { silent: true }).trim();
const excludedLabels = new Set(["autopilot-running", "autopilot-failed", "blocked", "needs-design"]);

if (!dryRun) {
  mkdirSync(workspacesDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  ensureLabels(["autopilot-running", "autopilot-failed"]);
}

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gh(args, options = {}) {
  const result = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.silent ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"]
  });
  if (result.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

function ensureLabels(labels) {
  for (const label of labels) {
    spawnSync("gh", ["label", "create", label, "--repo", repo, "--force"], { cwd: root, stdio: "ignore" });
  }
}

function git(args, cwd = root, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.silent ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"]
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

function readState() {
  if (!existsSync(statePath)) return { running: {}, completed: {}, failed: {} };
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  return { running: {}, completed: {}, failed: {}, ...state };
}

function writeState(state) {
  if (dryRun) return;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function recoverStaleLocks(state) {
  if (dryRun) return state;
  const now = Date.now();
  let changed = false;
  for (const [issueNumber, lock] of Object.entries(state.running)) {
    const startedAt = Date.parse(lock.startedAt ?? "");
    if (Number.isNaN(startedAt) || now - startedAt < staleLockMs) {
      continue;
    }
    delete state.running[issueNumber];
    state.failed[issueNumber] = {
      ...lock,
      stale: true,
      finishedAt: new Date().toISOString(),
      reason: `stale lock exceeded ${staleLockMs}ms`
    };
    try {
      gh(["issue", "edit", String(issueNumber), "--repo", repo, "--remove-label", "autopilot-running", "--add-label", "autopilot-failed"]);
    } catch (error) {
      console.error(`Failed to update stale issue #${issueNumber}: ${error.message}`);
    }
    changed = true;
  }
  if (changed) writeState(state);
  return state;
}

function eligibleIssues() {
  const output = gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--label",
    "capsule",
    "--label",
    "needs-verification",
    "--limit",
    "100",
    "--json",
    "number,title,body,url,labels"
  ], { silent: true });
  return JSON.parse(output)
    .filter((issue) => !issue.labels.some((label) => excludedLabels.has(label.name)))
    .filter((issue) => linkedOpenPullRequests(issue).length === 0)
    .sort((a, b) => issueSortKey(a) - issueSortKey(b));
}

function linkedOpenPullRequests(issue) {
  const branch = `autopilot/issue-${issue.number}`;
  const byBranch = JSON.parse(gh(["pr", "list", "--repo", repo, "--head", branch, "--state", "open", "--json", "number,url,title,headRefName"], { silent: true }));
  const byBody = JSON.parse(
    gh(["pr", "list", "--repo", repo, "--state", "open", "--search", `#${issue.number} in:body`, "--json", "number,url,title,headRefName"], {
      silent: true
    })
  );
  const prs = new Map();
  for (const pr of [...byBranch, ...byBody]) {
    prs.set(pr.number, pr);
  }
  return [...prs.values()];
}

function issueSortKey(issue) {
  const match = issue.title.match(/\[CAP-(\d+)\]/);
  return match ? Number(match[1]) : issue.number;
}

function promptFor(issue) {
  return `You are an autonomous Capsule maintainer working from GitHub issue #${issue.number}.

Repository: ${repo}
Issue: ${issue.url}
Title: ${issue.title}

Body:
${issue.body ?? ""}

Rules:
- Work only on this issue.
- Inspect the repo before editing.
- Keep Capsule capability maps honest. Do not fake provider support.
- Do not run live provider operations unless CAPSULE_LIVE_TESTS=1 and required credentials are present.
- Add focused tests or docs when the change affects behavior.
- Run pnpm capsule:gap, pnpm typecheck, pnpm test, and pnpm build when feasible.
- Commit atomically on the current branch.
- Push the branch and open a GitHub PR against main.
- Comment on issue #${issue.number} with the PR URL, verification commands, and remaining risks.
- Do not close the issue unless the PR is merged and verification is green.`;
}

function ensureBranch(issue) {
  const branch = `autopilot/issue-${issue.number}`;
  const workspace = join(workspacesDir, `issue-${issue.number}`);
  if (!existsSync(workspace)) {
    git(["fetch", "origin", "main"]);
    git(["worktree", "add", "-B", branch, workspace, "origin/main"]);
  } else {
    const dirty = git(["status", "--short"], workspace, { silent: true }).trim();
    if (!dirty) {
      git(["fetch", "origin", "main"], workspace);
      git(["merge", "--ff-only", "origin/main"], workspace);
    }
  }
  return { branch, workspace };
}

function commentIssue(issueNumber, body) {
  gh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", body]);
}

function runIssue(issue, state) {
  if (dryRun) {
    console.log(`[dry-run] would run issue #${issue.number}: ${issue.title}`);
    return Promise.resolve();
  }

  const { branch, workspace } = ensureBranch(issue);
  const logPath = join(logsDir, `issue-${issue.number}.log`);
  gh(["issue", "edit", String(issue.number), "--repo", repo, "--add-label", "autopilot-running"]);

  state.running[issue.number] = { branch, workspace, logPath, pid: process.pid, startedAt: new Date().toISOString() };
  writeState(state);

  const command = [
    "-s",
    "danger-full-access",
    "-a",
    "never",
    "exec",
    "--cd",
    workspace,
    promptFor(issue)
  ];

  const child = spawn("codex", command, {
    cwd: workspace,
    env: { ...process.env, GH_REPO: repo },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logStream = (chunk) => {
    process.stdout.write(chunk);
    writeFileSync(logPath, chunk, { flag: "a" });
  };
  child.stdout.on("data", logStream);
  child.stderr.on("data", logStream);

  return new Promise((resolve) => {
    child.on("exit", (code) => {
      const next = readState();
      delete next.running[issue.number];
      const openPrs = linkedOpenPullRequests(issue);
      const prLine = openPrs.length > 0 ? `\n\nOpen PR: ${openPrs.map((pr) => pr.url).join(", ")}` : "\n\nOpen PR: none detected.";
      if (code === 0) {
        next.completed[issue.number] = { branch, workspace, logPath, finishedAt: new Date().toISOString() };
        gh(["issue", "edit", String(issue.number), "--repo", repo, "--remove-label", "autopilot-running"]);
        commentIssue(issue.number, `Autopilot completed issue #${issue.number} with exit code 0.${prLine}\n\nLog: ${logPath}`);
      } else {
        next.failed[issue.number] = { branch, workspace, logPath, code, finishedAt: new Date().toISOString() };
        gh(["issue", "edit", String(issue.number), "--repo", repo, "--remove-label", "autopilot-running", "--add-label", "autopilot-failed"]);
        commentIssue(issue.number, `Autopilot failed issue #${issue.number} with exit code ${code}.${prLine}\n\nLog: ${logPath}`);
      }
      writeState(next);
      resolve();
    });
  });
}

async function tick() {
  const state = recoverStaleLocks(readState());
  const runningCount = Object.keys(state.running).length;
  const capacity = Math.max(0, maxParallel - runningCount);
  if (capacity === 0) return;

  const issues = eligibleIssues()
    .filter((issue) => !state.completed[issue.number] && !state.running[issue.number])
    .slice(0, capacity);

  if (issues.length === 0) {
    console.log(`[${new Date().toISOString()}] no eligible issues`);
    return;
  }

  await Promise.all(issues.map((issue) => runIssue(issue, state)));
}

console.log(`Capsule autopilot starting for ${repo}; maxParallel=${maxParallel}; once=${once}; dryRun=${dryRun}`);

do {
  await tick();
  if (once) break;
  await new Promise((resolveTimeout) => setTimeout(resolveTimeout, pollMs));
} while (true);
