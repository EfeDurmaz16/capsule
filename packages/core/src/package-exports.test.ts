import { existsSync, readFileSync, readdirSync } from "node:fs";
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

describe("package export maps", () => {
  test("every public package exports its entrypoint through dist", () => {
    for (const packageDir of packageDirs(packagesDir)) {
      const pkg = readJson(join(packageDir, "package.json"));
      if (pkg.private === true) continue;

      expect(pkg.main, `${pkg.name} main`).toBe("./dist/index.js");
      expect(pkg.types, `${pkg.name} types`).toBe("./dist/index.d.ts");
      expect(pkg.exports?.["."]?.import, `${pkg.name} exports import`).toBe("./dist/index.js");
      expect(pkg.exports?.["."]?.types, `${pkg.name} exports types`).toBe("./dist/index.d.ts");
      expect(existsSync(join(packageDir, "src", "index.ts")), `${pkg.name} src/index.ts`).toBe(true);
    }
  });

  test("examples import packages through public package exports", () => {
    const privateImportPattern = /from\s+["'](@capsule\/[^"']+\/[^"']+)["']/g;
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
