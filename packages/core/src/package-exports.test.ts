import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const packagesDir = join(root, "packages");
const examplesDir = join(root, "examples");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

function packageDirs(baseDir: string) {
  return readdirSync(baseDir)
    .map((dir) => join(baseDir, dir))
    .filter((dir) => existsSync(join(dir, "package.json")));
}

const runtimeExportKinds = new Set(["class", "const", "enum", "function", "namespace", "symbol", "variable"]);

function publicPackageDirs() {
  return packageDirs(packagesDir).filter((packageDir) => readJson(join(packageDir, "package.json")).private !== true);
}

function linkPackageNodeModules(sourceNodeModules: string, targetNodeModules: string, scopedNodeModules: string) {
  if (!existsSync(sourceNodeModules)) return;
  mkdirSync(targetNodeModules, { recursive: true });
  for (const entry of readdirSync(sourceNodeModules)) {
    if (entry === ".bin") continue;
    if (entry === "@capsule-sdk") {
      const sourceScope = join(sourceNodeModules, entry);
      const targetScope = join(targetNodeModules, entry);
      mkdirSync(targetScope, { recursive: true });
      for (const scopedEntry of readdirSync(sourceScope)) {
        const tempPackage = join(scopedNodeModules, scopedEntry);
        symlinkSync(existsSync(tempPackage) ? tempPackage : join(sourceScope, scopedEntry), join(targetScope, scopedEntry));
      }
      continue;
    }
    symlinkSync(join(sourceNodeModules, entry), join(targetNodeModules, entry));
  }
}

function expectedRuntimeExportsByPackage() {
  const apiReference = readFileSync(join(root, "docs", "api-reference.md"), "utf8");
  const entries = new Map<string, string[]>();
  for (const section of apiReference.split(/^## /m).slice(1)) {
    const [packageNameLine = "", ...lines] = section.split("\n");
    const packageName = packageNameLine.trim();
    if (!packageName.startsWith("@capsule-sdk/")) continue;
    const runtimeExports: string[] = [];
    for (const line of lines) {
      const match = line.match(/^- `([^`]+)` \(([^)]+)\)$/);
      if (match?.[1] && match[2] && runtimeExportKinds.has(match[2])) {
        runtimeExports.push(match[1]);
      }
    }
    runtimeExports.sort((left, right) => left.localeCompare(right));
    entries.set(packageName, runtimeExports);
  }
  return entries;
}

describe("package export maps", () => {
  test("every public package exports its entrypoint through dist", () => {
    for (const packageDir of publicPackageDirs()) {
      const pkg = readJson(join(packageDir, "package.json"));

      expect(pkg.main, `${pkg.name} main`).toBe("./dist/index.js");
      expect(pkg.types, `${pkg.name} types`).toBe("./dist/index.d.ts");
      expect(pkg.exports?.["."]?.import, `${pkg.name} exports import`).toBe("./dist/index.js");
      expect(pkg.exports?.["."]?.types, `${pkg.name} exports types`).toBe("./dist/index.d.ts");
      expect(existsSync(join(packageDir, "src", "index.ts")), `${pkg.name} src/index.ts`).toBe(true);
    }
  });

  test("public packages import by package name and match the API snapshot", () => {
    const packages = publicPackageDirs().map((packageDir) => ({ dir: packageDir, pkg: readJson(join(packageDir, "package.json")) }));
    const expected = expectedRuntimeExportsByPackage();

    expect([...expected.keys()].sort()).toEqual(packages.map(({ pkg }) => String(pkg.name)).sort());

    const tempRoot = mkdtempSync(join(tmpdir(), "capsule-package-exports-"));
    try {
      const tempNodeModules = join(tempRoot, "node_modules");
      const scopedNodeModules = join(tempNodeModules, "@capsule-sdk");
      mkdirSync(scopedNodeModules, { recursive: true });
      for (const { dir, pkg } of packages) {
        const packageRoot = join(scopedNodeModules, String(pkg.name).replace("@capsule-sdk/", ""));
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, "package.json"),
          `${JSON.stringify({ name: pkg.name, type: "module", exports: { ".": "./src/index.ts" } }, null, 2)}\n`
        );
        cpSync(join(dir, "src"), join(packageRoot, "src"), { recursive: true, dereference: true });
      }

      for (const { dir, pkg } of packages) {
        const packageRoot = join(scopedNodeModules, String(pkg.name).replace("@capsule-sdk/", ""));
        linkPackageNodeModules(join(dir, "node_modules"), join(packageRoot, "node_modules"), scopedNodeModules);
      }

      const verifierPath = join(tempRoot, "verify-package-exports.mjs");
      writeFileSync(
        verifierPath,
        `const expected = new Map(${JSON.stringify([...expected.entries()])});
for (const [packageName, expectedExports] of expected) {
  const mod = await import(packageName);
  const actualExports = Object.keys(mod).filter((name) => name !== "default").sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
    throw new Error(\`\${packageName} export mismatch\\nexpected: \${expectedExports.join(", ")}\\nactual: \${actualExports.join(", ")}\`);
  }
}
process.exit(0);
`
      );

      execFileSync(process.execPath, ["--import", "tsx", verifierPath], {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 35_000);

  test("examples import packages through public package exports", () => {
    const privateImportPattern = /from\s+["'](@capsule-sdk\/[^"']+\/[^"']+)["']/g;
    for (const exampleDir of packageDirs(examplesDir)) {
      const srcDir = join(exampleDir, "src");
      if (!existsSync(srcDir)) continue;
      for (const file of readdirSync(srcDir).filter((name) => name.endsWith(".ts"))) {
        const source = readFileSync(join(srcDir, file), "utf8");
        const privateImports = [...source.matchAll(privateImportPattern)].map((match) => match[1]);
        expect(privateImports, `${exampleDir}/${file} private @capsule imports`).toEqual([]);
      }
    }
  });
});
