import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workspaceDirs = ["packages", "examples"];
const buildInfoFiles = ["tsconfig.tsbuildinfo", "tsconfig.build.tsbuildinfo"];

function cleanWorkspaceDir(parentDir) {
  const absoluteParent = join(root, parentDir);
  if (!existsSync(absoluteParent)) {
    return;
  }

  for (const entry of readdirSync(absoluteParent, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspacePath = join(absoluteParent, entry.name);
    rmSync(join(workspacePath, "dist"), { recursive: true, force: true });

    for (const buildInfoFile of buildInfoFiles) {
      rmSync(join(workspacePath, buildInfoFile), { force: true });
    }
  }
}

for (const workspaceDir of workspaceDirs) {
  cleanWorkspaceDir(workspaceDir);
}
