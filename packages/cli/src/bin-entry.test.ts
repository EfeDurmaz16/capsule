// The CLI must run when node starts it through a symlink, as npm's bin link and macOS /tmp do. The
// source runs under the tsx loader; no provider is contacted (`--help` only).
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = realpathSync(fileURLToPath(new URL("./index.ts", import.meta.url)));
const tsx = createRequire(import.meta.url).resolve("tsx");

describe.skipIf(process.platform === "win32")("capsule bin entry", () => {
  it("runs the command when started through a symlink to the entry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "capsule-bin-link-"));
    try {
      const link = join(dir, "capsule");
      symlinkSync(entry, link);
      const viaLink = spawnSync(process.execPath, ["--import", tsx, link, "--help"], { encoding: "utf8", timeout: 60_000 });
      const direct = spawnSync(process.execPath, ["--import", tsx, entry, "--help"], { encoding: "utf8", timeout: 60_000 });
      expect(direct.stdout).toContain("Capsule CLI");
      expect(viaLink.status).toBe(0);
      expect(viaLink.stdout).toBe(direct.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
