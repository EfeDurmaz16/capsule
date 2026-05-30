import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");

function walk(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const distDir = join(packagesDir, entry.name, "dist");
  for (const file of walk(distDir)) {
    if (file.includes(".test.")) {
      rmSync(file, { force: true });
    }
  }
}
