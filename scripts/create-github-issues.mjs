#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const apply = process.argv.includes("--apply");
const graph = JSON.parse(readFileSync(join(root, ".capsule/tasks.json"), "utf8"));
const ensuredLabels = new Set();

function bodyFor(task) {
  return [
    `Source task: ${task.id}`,
    "",
    "## Success Criteria",
    "",
    ...task.successCriteria.map((item) => `- [ ] ${item}`),
    "",
    "## Harness Notes",
    "",
    "- Keep changes atomic.",
    "- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` when feasible.",
    "- Do not run live provider operations unless explicitly gated by credentials and `CAPSULE_LIVE_TESTS=1`."
  ].join("\n");
}

for (const task of graph.tasks) {
  const labels = [...new Set([...(graph.labels ?? []), ...(task.labels ?? [])])];
  const title = `[${task.id}] ${task.title}`;
  const body = bodyFor(task);

  if (!apply) {
    console.log(`\n# ${title}`);
    console.log(`Labels: ${labels.join(",")}`);
    console.log(body);
    continue;
  }

  for (const label of labels) {
    if (ensuredLabels.has(label)) continue;
    spawnSync("gh", ["label", "create", label, "--force"], { cwd: root, stdio: "ignore" });
    ensuredLabels.add(label);
  }

  const tmp = mkdtempSync(join(tmpdir(), "capsule-issue-"));
  const bodyPath = join(tmp, "body.md");
  writeFileSync(bodyPath, body);

  const args = ["issue", "create", "--title", title, "--body-file", bodyPath];
  for (const label of labels) args.push("--label", label);

  const result = spawnSync("gh", args, { cwd: root, stdio: "inherit" });
  rmSync(tmp, { recursive: true, force: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!apply) {
  console.log("\nRun `pnpm capsule:issues -- --apply` to create these GitHub issues after review.");
}
