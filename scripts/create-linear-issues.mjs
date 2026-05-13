#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const apply = process.argv.includes("--apply");
const tasksIndex = process.argv.indexOf("--tasks");
const tasksPath = resolve(root, tasksIndex >= 0 ? process.argv[tasksIndex + 1] : ".capsule/tasks.json");
const apiKey = process.env.LINEAR_API_KEY;
const teamId = process.env.LINEAR_TEAM_ID;
const projectId = process.env.LINEAR_PROJECT_ID;
const labelPrefix = process.env.LINEAR_LABEL_PREFIX ?? "capsule";

const tasks = JSON.parse(readFileSync(tasksPath, "utf8"));

function taskDescription(task) {
  return [
    `Source task: ${task.id}`,
    "",
    "## Success Criteria",
    "",
    ...(task.successCriteria ?? []).map((criterion) => `- [ ] ${criterion}`),
    "",
    "## Labels",
    "",
    (task.labels ?? []).map((label) => `- ${label}`).join("\n"),
    "",
    "## Harness Notes",
    "",
    "- Keep changes atomic.",
    "- Run pnpm typecheck, pnpm test, and pnpm build when feasible.",
    "- Do not run live provider operations unless CAPSULE_LIVE_TESTS=1 and credentials are present."
  ].join("\n");
}

async function linearRequest(query, variables) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(JSON.stringify(json.errors ?? json, null, 2));
  }
  return json.data;
}

async function createIssue(task) {
  const data = await linearRequest(
    `mutation CapsuleCreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }`,
    {
      input: {
        teamId,
        title: `[${task.id}] ${task.title}`,
        description: taskDescription(task),
        ...(projectId ? { projectId } : {}),
        labelIds: []
      }
    }
  );
  return data.issueCreate.issue;
}

if (!apply) {
  console.log(`[dry-run] would mirror ${tasks.tasks.length} tasks from ${tasksPath} to Linear.`);
  console.log("[dry-run] pass --apply with LINEAR_API_KEY and LINEAR_TEAM_ID to create issues.");
  for (const task of tasks.tasks) {
    console.log(`- [${task.id}] ${task.title} (${[labelPrefix, ...(task.labels ?? [])].join(", ")})`);
  }
  process.exit(0);
}

if (!apiKey || !teamId) {
  throw new Error("LINEAR_API_KEY and LINEAR_TEAM_ID are required when using --apply.");
}

for (const task of tasks.tasks) {
  const issue = await createIssue(task);
  console.log(`Created ${issue.identifier}: ${issue.url}`);
}
