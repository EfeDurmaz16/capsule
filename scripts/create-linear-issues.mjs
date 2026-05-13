#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const apply = process.argv.includes("--apply");
const tasksIndex = process.argv.indexOf("--tasks");
const tasksPath = resolve(root, tasksIndex >= 0 ? process.argv[tasksIndex + 1] : ".capsule/tasks.json");
const apiKey = process.env.LINEAR_API_KEY;
const configuredTeamId = process.env.LINEAR_TEAM_ID;
const teamKey = process.env.LINEAR_TEAM_KEY;
const configuredProjectId = process.env.LINEAR_PROJECT_ID;
const projectSlug = process.env.LINEAR_PROJECT_SLUG;
const configuredStateId = process.env.LINEAR_STATE_ID;
const stateName = process.env.LINEAR_STATE_NAME;
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

async function resolveTeamId() {
  if (configuredTeamId) return configuredTeamId;
  if (!teamKey) return undefined;
  const data = await linearRequest(
    `query CapsuleTeamByKey($key: String!) {
      teams(filter: { key: { eq: $key } }, first: 10) {
        nodes { id key name }
      }
    }`,
    { key: teamKey }
  );
  const matches = data.teams.nodes;
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Linear team for LINEAR_TEAM_KEY=${teamKey}, found ${matches.length}.`);
  }
  return matches[0].id;
}

async function resolveProjectId() {
  if (configuredProjectId) return configuredProjectId;
  if (!projectSlug) return undefined;
  const slugId = projectSlug.split("-").at(-1);
  const data = await linearRequest(
    `query CapsuleProjectBySlug($slugId: String!) {
      projects(filter: { slugId: { eq: $slugId } }, first: 10) {
        nodes { id name slugId url state }
      }
    }`,
    { slugId }
  );
  const matches = data.projects.nodes;
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Linear project for LINEAR_PROJECT_SLUG=${projectSlug} / slugId=${slugId}, found ${matches.length}.`);
  }
  return matches[0].id;
}

async function resolveStateId(teamId) {
  if (configuredStateId) return configuredStateId;
  if (!stateName) return undefined;
  const data = await linearRequest(
    `query CapsuleWorkflowState($teamId: ID!, $name: String!) {
      workflowStates(filter: { team: { id: { eq: $teamId } }, name: { eq: $name } }, first: 10) {
        nodes { id name type }
      }
    }`,
    { teamId, name: stateName }
  );
  const matches = data.workflowStates.nodes;
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Linear workflow state named ${stateName} for team ${teamId}, found ${matches.length}.`);
  }
  return matches[0].id;
}

async function createIssue(task, ids) {
  const data = await linearRequest(
    `mutation CapsuleCreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }`,
    {
      input: {
        teamId: ids.teamId,
        title: `[${task.id}] ${task.title}`,
        description: taskDescription(task),
        ...(ids.projectId ? { projectId: ids.projectId } : {}),
        ...(ids.stateId ? { stateId: ids.stateId } : {}),
        labelIds: []
      }
    }
  );
  return data.issueCreate.issue;
}

if (!apply) {
  console.log(`[dry-run] would mirror ${tasks.tasks.length} tasks from ${tasksPath} to Linear.`);
  console.log("[dry-run] pass --apply with LINEAR_API_KEY and either LINEAR_TEAM_ID or LINEAR_TEAM_KEY to create issues.");
  console.log("[dry-run] set LINEAR_PROJECT_ID or LINEAR_PROJECT_SLUG to attach issues to a Linear project.");
  console.log("[dry-run] set LINEAR_STATE_ID or LINEAR_STATE_NAME to create issues directly in a Symphony active state.");
  for (const task of tasks.tasks) {
    console.log(`- [${task.id}] ${task.title} (${[labelPrefix, ...(task.labels ?? [])].join(", ")})`);
  }
  process.exit(0);
}

if (!apiKey) {
  throw new Error("LINEAR_API_KEY is required when using --apply.");
}

const ids = {
  teamId: await resolveTeamId(),
  projectId: await resolveProjectId(),
  stateId: undefined
};

if (!ids.teamId) {
  throw new Error("Set LINEAR_TEAM_ID or LINEAR_TEAM_KEY when using --apply.");
}

ids.stateId = await resolveStateId(ids.teamId);

for (const task of tasks.tasks) {
  const issue = await createIssue(task, ids);
  console.log(`Created ${issue.identifier}: ${issue.url}`);
}
