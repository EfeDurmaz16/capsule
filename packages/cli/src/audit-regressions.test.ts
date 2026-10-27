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

  describe("CLI-03: dedicated neon commands select Neon", () => {
    interface FetchCall {
      method: string;
      url: string;
    }

    // Answers with the Neon v2 API response shapes the adapter reads: POST/DELETE branch return
    // { branch, operations }. No network is contacted and the API key is a fixture value.
    async function withFakeNeon<T>(run: (calls: FetchCall[]) => Promise<T>): Promise<T> {
      const calls: FetchCall[] = [];
      const previousKey = process.env.NEON_API_KEY;
      process.env.NEON_API_KEY = "fixture-neon-key";
      vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        const method = init.method ?? "GET";
        calls.push({ method, url });
        const branchId = method === "DELETE" ? (url.split("/branches/")[1]?.split("?")[0] ?? "br_fixture") : "br_fixture";
        return new Response(JSON.stringify({ branch: { id: branchId, name: "audit", parent_id: "br_main", current_state: "ready" }, operations: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      });
      try {
        return await run(calls);
      } finally {
        vi.unstubAllGlobals();
        if (previousKey === undefined) delete process.env.NEON_API_KEY;
        else process.env.NEON_API_KEY = previousKey;
      }
    }

    it("runs the advertised branch-create shape against Neon with no adapter flag", async () => {
      await withFakeNeon(async (calls) => {
        const result = await runInFakeDockerProject(["neon", "branch-create", "--project", "audit", "--name", "audit"]);
        expect(result.outcome).toBe("resolved");
        expect(calls).toEqual([{ method: "POST", url: "https://console.neon.tech/api/v2/projects/audit/branches" }]);
        expect(JSON.parse(result.logs[0] ?? "{}")).toMatchObject({ id: "br_fixture", provider: "neon", project: "audit" });
        expect(result.calls).toEqual([]);
      });
    });

    it("runs the advertised branch-delete shape against Neon with no adapter flag", async () => {
      await withFakeNeon(async (calls) => {
        const result = await runInFakeDockerProject(["neon", "branch-delete", "--project", "audit", "--branch-id", "br_xxx", "--hard-delete"]);
        expect(result.outcome).toBe("resolved");
        expect(calls).toEqual([{ method: "DELETE", url: "https://console.neon.tech/api/v2/projects/audit/branches/br_xxx?hard_delete=true" }]);
        expect(result.calls).toEqual([]);
      });
    });

    it("rejects a contradictory --adapter instead of rerouting", async () => {
      await withFakeNeon(async (calls) => {
        const result = await runInFakeDockerProject(["neon", "branch-create", "--adapter", "docker", "--project", "audit", "--name", "audit"]);
        expect(result.outcome).toBe("rejected");
        expect(errorMessage(result.error)).toMatch(/neon commands require the neon adapter, but --adapter selects "docker"/);
        expect(calls).toEqual([]);
        expect(result.calls).toEqual([]);
      });
    });

    it("rejects a contradictory configured adapter, and an explicit --adapter neon overrides it", async () => {
      await withFakeNeon(async (calls) => {
        const files = { "capsule.config.json": { adapter: "docker" } };
        const rejected = await runInFakeDockerProject(["neon", "branch-create", "--project", "audit", "--name", "audit"], files);
        expect(rejected.outcome).toBe("rejected");
        expect(errorMessage(rejected.error)).toMatch(/capsule\.config\.json selects "docker"/);
        expect(calls).toEqual([]);

        const accepted = await runInFakeDockerProject(["neon", "branch-create", "--adapter", "neon", "--project", "audit", "--name", "audit"], files);
        expect(accepted.outcome).toBe("resolved");
        expect(calls).toHaveLength(1);
      });
    });

    it("accepts the mock-neon adapter for offline use", async () => {
      await withFakeNeon(async (calls) => {
        const result = await runInFakeDockerProject(["neon", "branch-create", "--adapter", "mock-neon", "--project", "audit", "--name", "audit"]);
        expect(result.outcome).toBe("resolved");
        expect(calls).toEqual([]);
      });
    });
  });
});
