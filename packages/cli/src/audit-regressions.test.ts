// Audit regressions for the M1 campaign (CLI-01, CLI-02, CLI-03). Each test asserts the INTENDED behavior.
// A local fake `docker` executable on PATH records invocations; no Docker daemon or container is used, and
// no provider API is contacted.
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

interface FakeDockerProject {
  outcome: "resolved" | "rejected";
  error?: unknown;
  calls: string[];
  logs: string[];
}

// Runs the real CLI entry point from a scratch project directory with a fake docker on PATH.
async function runInFakeDockerProject(argv: string[], files: Record<string, unknown> = {}): Promise<FakeDockerProject> {
  const root = await mkdtemp(join(tmpdir(), "capsule-cli-audit-"));
  const previous = { cwd: process.cwd(), path: process.env.PATH, log: process.env.CAPSULE_FAKE_DOCKER_LOG, exitCode: process.exitCode };
  const logs: string[] = [];
  const quiet = [
    vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      logs.push(String(value));
    }),
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  ];
  const callLog = join(root, "docker-calls.txt");
  try {
    await writeFile(join(root, "docker"), fakeDocker, "utf8");
    await chmod(join(root, "docker"), 0o755);
    await writeFile(callLog, "", "utf8");
    for (const [name, value] of Object.entries(files)) {
      await writeFile(join(root, name), typeof value === "string" ? value : JSON.stringify(value), "utf8");
    }
    process.env.PATH = `${root}:/usr/bin:/bin`;
    process.env.CAPSULE_FAKE_DOCKER_LOG = callLog;
    process.chdir(root);
    let error: unknown;
    const outcome = await main(argv).then(
      () => "resolved" as const,
      (caught: unknown) => {
        error = caught;
        return "rejected" as const;
      }
    );
    const calls = (await readFile(callLog, "utf8")).split("\n").filter(Boolean);
    return { outcome, error, calls, logs };
  } finally {
    process.chdir(previous.cwd);
    process.env.PATH = previous.path;
    process.exitCode = previous.exitCode;
    if (previous.log === undefined) delete process.env.CAPSULE_FAKE_DOCKER_LOG;
    else process.env.CAPSULE_FAKE_DOCKER_LOG = previous.log;
    quiet.forEach((spy) => spy.mockRestore());
    await rm(root, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("M1 audit regressions: cli", () => {
  it.fails("CLI-01: a configured policy file is enforced by run before any provider effect", async () => {
    const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
      "capsule.config.json": { adapter: "docker", policyFile: "capsule.policy.json" },
      "capsule.policy.json": { network: { mode: "none" }, approvals: { required: true, reason: "fixture-deny-before-execution" } }
    });
    expect(result.outcome).toBe("rejected");
    expect(result.calls.filter((line) => line.startsWith("run "))).toEqual([]);
  });

  describe("CLI-02: adapter names fail closed", () => {
    it("rejects an unknown --adapter before any provider is created", async () => {
      const result = await runInFakeDockerProject(["run", "--adapter", "typo-cloud", "--image", "fixture-image", "--", "echo", "fixture"]);
      expect(result.outcome).toBe("rejected");
      expect(errorMessage(result.error)).toMatch(/Unknown adapter "typo-cloud" \(from --adapter\)/);
      expect(errorMessage(result.error)).toMatch(/docker/);
      expect(result.calls).toEqual([]);
    });

    it("rejects an unknown configured adapter instead of falling back to docker", async () => {
      const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
        "capsule.config.json": { adapter: "dockr" }
      });
      expect(result.outcome).toBe("rejected");
      expect(errorMessage(result.error)).toMatch(/Unknown adapter "dockr" \(from capsule\.config\.json\)/);
      expect(result.calls).toEqual([]);
    });

    it("rejects an unknown adapter for report commands too", async () => {
      const result = await runInFakeDockerProject(["capabilities", "--adapter", "typo-cloud", "--json"]);
      expect(result.outcome).toBe("rejected");
      expect(result.logs).toEqual([]);
    });

    it("keeps docker as the documented default only when no adapter is selected", async () => {
      const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"]);
      expect(result.outcome).toBe("resolved");
      expect(result.calls.filter((line) => line.startsWith("run "))).toHaveLength(1);
    });

    it("routes a known mock adapter name to the mock adapter rather than docker", async () => {
      const result = await runInFakeDockerProject(["capabilities", "--adapter", "mock-e2b", "--json"]);
      expect(result.outcome).toBe("resolved");
      expect(JSON.parse(result.logs[0] ?? "{}")).toMatchObject({ adapter: "mock-e2b" });
      expect(result.calls).toEqual([]);
    });
  });
});
