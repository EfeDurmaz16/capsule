// The CLI must run when node starts it through a symlink, as npm's bin link and macOS /tmp do. The
// source runs under the tsx loader; no provider is contacted (`--help` only). The child resolves the
// workspace packages to their sources through the typecheck path map, as vitest's aliases do, so the
// test does not depend on a prior build (CI runs the tests before `pnpm build`).
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = realpathSync(fileURLToPath(new URL("./index.ts", import.meta.url)));
const tsx = createRequire(import.meta.url).resolve("tsx");
const sourcePathMap = fileURLToPath(new URL("../../../tsconfig.typecheck.json", import.meta.url));
const childEnv = { ...process.env, TSX_TSCONFIG_PATH: sourcePathMap };

describe.skipIf(process.platform === "win32")("capsule bin entry", () => {
  it("runs the command when started through a symlink to the entry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "capsule-bin-link-"));
    try {
      const link = join(dir, "capsule");
      symlinkSync(entry, link);
      const run = (path: string) => spawnSync(process.execPath, ["--import", tsx, path, "--help"], { encoding: "utf8", env: childEnv, timeout: 60_000 });
      const viaLink = run(link);
      const direct = run(entry);
      expect(direct.status, direct.stderr).toBe(0);
      expect(direct.stdout).toContain("Capsule CLI");
      expect(viaLink.status).toBe(0);
      expect(viaLink.stdout).toBe(direct.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
