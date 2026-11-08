import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Removes from each package's dist what a consumer can never load: test output, and declaration files
// that the package's `types` entry does not reach through relative imports. The export maps expose only
// the entry, so an unreached declaration is dead weight in the tarball.

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

function reachedDeclarations(entry) {
  const reached = new Set();
  const visit = (file) => {
    if (reached.has(file) || !existsSync(file)) return;
    reached.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      visit(resolve(dirname(file), match[1].replace(/\.js$/, ".d.ts")));
    }
  };
  visit(entry);
  return reached;
}

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const packageDir = join(packagesDir, entry.name);
  const distDir = join(packageDir, "dist");
  for (const file of walk(distDir)) {
    if (file.includes(".test.")) {
      rmSync(file, { force: true });
    }
  }

  const manifest = join(packageDir, "package.json");
  const types = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).types : undefined;
  if (typeof types !== "string" || !existsSync(join(packageDir, types))) {
    continue;
  }
  const reached = reachedDeclarations(resolve(packageDir, types));
  for (const file of walk(distDir)) {
    if ((file.endsWith(".d.ts") || file.endsWith(".d.ts.map")) && !reached.has(resolve(file.replace(/\.map$/, "")))) {
      rmSync(file, { force: true });
    }
  }
}
