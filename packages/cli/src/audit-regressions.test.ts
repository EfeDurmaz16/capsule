// Audit regression for the M1 campaign (CLI-01). Asserts the INTENDED behavior and is marked it.fails
// while the defect is present on the baseline (7d3a28a); the owner flips it to it when fixed. A local fake
// `docker` executable on PATH records invocations; no Docker daemon or container is used.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "./index.js";

const fakeDocker = `#!/bin/sh
printf '%s\\n' "$*" >> "$CAPSULE_FAKE_DOCKER_LOG"
case "$1" in
  version) printf 'fixture-version\\n' ;;
  run) printf 'fixture-executed\\n' ;;
  *) printf 'unexpected fake Docker command\\n' >&2; exit 93 ;;
esac
`;

describe("M1 audit regressions: cli", () => {
  it.fails("CLI-01: a configured policy file is enforced by run before any provider effect", async () => {
    const root = await mkdtemp(join(tmpdir(), "capsule-cli01-"));
    const previous = { cwd: process.cwd(), path: process.env.PATH, log: process.env.CAPSULE_FAKE_DOCKER_LOG };
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
    const callLog = join(root, "docker-calls.txt");
    try {
      await writeFile(join(root, "docker"), fakeDocker, "utf8");
      await chmod(join(root, "docker"), 0o755);
      await writeFile(callLog, "", "utf8");
      await writeFile(join(root, "capsule.config.json"), JSON.stringify({ adapter: "docker", policyFile: "capsule.policy.json" }), "utf8");
      await writeFile(
        join(root, "capsule.policy.json"),
        JSON.stringify({ network: { mode: "none" }, approvals: { required: true, reason: "fixture-deny-before-execution" } }),
        "utf8"
      );
      process.env.PATH = `${root}:/usr/bin:/bin`;
      process.env.CAPSULE_FAKE_DOCKER_LOG = callLog;
      process.chdir(root);
      const outcome = await main(["run", "--image", "fixture-image", "--", "echo", "fixture"]).then(
        () => "resolved",
        () => "rejected"
      );
      const calls = (await readFile(callLog, "utf8")).split("\n").filter(Boolean);
      expect(outcome).toBe("rejected");
      expect(calls.filter((line) => line.startsWith("run "))).toEqual([]);
    } finally {
      process.chdir(previous.cwd);
      process.env.PATH = previous.path;
      if (previous.log === undefined) delete process.env.CAPSULE_FAKE_DOCKER_LOG;
      else process.env.CAPSULE_FAKE_DOCKER_LOG = previous.log;
      quiet.forEach((spy) => spy.mockRestore());
      await rm(root, { recursive: true, force: true });
    }
  });
});
