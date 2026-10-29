// Audit regressions for the M1 campaign (CLI-01, CLI-02, CLI-03). Each test asserts the INTENDED behavior.
// A local fake `docker` executable on PATH records invocations; no Docker daemon or container is used, and
// no provider API is contacted.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./index.js";

const fakeDocker = `#!/bin/sh
printf '%s\\n' "$*" >> "$CAPSULE_FAKE_DOCKER_LOG"
case "$1" in
  version) printf 'fixture-version\\n' ;;
  run) printf 'fixture-executed\\n' ;;
  *) printf 'unexpected fake Docker command\\n' >&2; exit 93 ;;
esac
`;

// Marks an entry in the files map that should be created as a directory rather than a file.
const asDirectory = Symbol("directory");

interface FakeDockerProject {
  outcome: "resolved" | "rejected";
  error?: unknown;
  calls: string[];
  logs: string[];
}

interface FetchCall {
  method: string;
  url: string;
}

// Process state a CLI run changes, captured once when the file loads. A run restores this snapshot, never
// a value it read at its own start, which can be the leftover of a run that is still going.
const pristine = {
  cwd: process.cwd(),
  path: process.env.PATH,
  fakeDockerLog: process.env.CAPSULE_FAKE_DOCKER_LOG,
  neonApiKey: process.env.NEON_API_KEY,
  exitCode: process.exitCode
};

// cwd, PATH, env, console and fetch belong to the whole process, so two CLI runs must never overlap. A test
// that times out does not stop its run, so each run starts only after the previous one has restored state.
let lastRun: Promise<unknown> = Promise.resolve();

// The run of a test that timed out finishes in that test's own afterEach, so the failure stays with that
// test and the next test starts from the pristine state with its whole timeout.
afterEach(() => lastRun);

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// Answers with the Neon v2 API response shapes the adapter reads: POST/DELETE branch return
// { branch, operations }. No network is contacted and the API key is a fixture value.
function fakeNeonFetch(calls: FetchCall[]) {
  return async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url });
    const branchId = method === "DELETE" ? (url.split("/branches/")[1]?.split("?")[0] ?? "br_fixture") : "br_fixture";
    return new Response(JSON.stringify({ branch: { id: branchId, name: "audit", parent_id: "br_main", current_state: "ready" }, operations: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
}

// Runs the real CLI entry point from a scratch project directory with a fake docker on PATH. With
// neonCalls, fetch is a fake Neon API that records into it. Runs are queued so they never overlap.
function runInFakeDockerProject(argv: string[], files: Record<string, unknown> = {}, neonCalls?: FetchCall[]): Promise<FakeDockerProject> {
  const run = lastRun.then(() => runAlone(argv, files, neonCalls));
  lastRun = run.catch(() => undefined);
  return run;
}

async function runAlone(argv: string[], files: Record<string, unknown>, neonCalls: FetchCall[] | undefined): Promise<FakeDockerProject> {
  const root = await mkdtemp(join(tmpdir(), "capsule-cli-audit-"));
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
      if (value === asDirectory) {
        await mkdir(join(root, name), { recursive: true });
        continue;
      }
      await writeFile(join(root, name), typeof value === "string" ? value : JSON.stringify(value), "utf8");
    }
    if (neonCalls) {
      vi.stubGlobal("fetch", fakeNeonFetch(neonCalls));
      process.env.NEON_API_KEY = "fixture-neon-key";
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
    process.chdir(pristine.cwd);
    process.env.PATH = pristine.path;
    process.exitCode = pristine.exitCode;
    restoreEnv("CAPSULE_FAKE_DOCKER_LOG", pristine.fakeDockerLog);
    restoreEnv("NEON_API_KEY", pristine.neonApiKey);
    vi.unstubAllGlobals();
    quiet.forEach((spy) => spy.mockRestore());
    await rm(root, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("M1 audit regressions: cli", () => {
  describe("CLI-01: configured policy is enforced at the execution boundary", () => {
    const denyPolicy = { network: { mode: "none" }, approvals: { required: true, reason: "fixture-deny-before-execution" } };

    it("a configured policy file is enforced by run before any provider effect", async () => {
      const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
        "capsule.config.json": { adapter: "docker", policyFile: "capsule.policy.json" },
        "capsule.policy.json": denyPolicy
      });
      expect(result.outcome).toBe("rejected");
      expect(errorMessage(result.error)).toMatch(/fixture-deny-before-execution|approval/i);
      expect(result.calls).toEqual([]);
    });

    it("an explicit --policy-file is enforced by sandbox and job commands too", async () => {
      for (const argv of [
        ["sandbox", "--policy-file", "deny.json", "--image", "fixture-image", "--", "echo", "fixture"],
        ["job", "run", "--policy-file", "deny.json", "--image", "fixture-image", "--", "echo", "fixture"]
      ]) {
        const result = await runInFakeDockerProject(argv, { "deny.json": denyPolicy });
        expect(result.outcome).toBe("rejected");
        expect(result.calls).toEqual([]);
      }
    });

    it("the --policy-file flag overrides the configured policy file", async () => {
      const result = await runInFakeDockerProject(["run", "--policy-file", "open.json", "--image", "fixture-image", "--", "echo", "fixture"], {
        "capsule.config.json": { policyFile: "deny.json" },
        "deny.json": denyPolicy,
        "open.json": { network: { mode: "none" } }
      });
      expect(result.outcome).toBe("resolved");
      expect(result.calls.filter((line) => line.startsWith("run "))).toHaveLength(1);
    });

    it("network none from the configured policy reaches the docker arguments and the receipt", async () => {
      const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
        "capsule.config.json": { policyFile: "capsule.policy.json" },
        "capsule.policy.json": { network: { mode: "none" } }
      });
      expect(result.outcome).toBe("resolved");
      const runCalls = result.calls.filter((line) => line.startsWith("run "));
      expect(runCalls).toHaveLength(1);
      expect(runCalls[0]).toContain("--network none");
      const receipt = JSON.parse(result.logs.find((line) => line.trim().startsWith("{")) ?? "{}") as { policy?: { applied?: unknown } };
      expect(receipt.policy?.applied).toMatchObject({ network: { mode: "none" } });
    });

    it("a missing configured policy file fails before any provider call", async () => {
      const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
        "capsule.config.json": { policyFile: "missing.policy.json" }
      });
      expect(result.outcome).toBe("rejected");
      expect(errorMessage(result.error)).toMatch(/missing\.policy\.json.*capsule\.config\.json/);
      expect(result.calls).toEqual([]);
    });

    it("an invalid policy file fails before any provider call", async () => {
      for (const body of ["{ not json", "[]", JSON.stringify({ netwrok: { mode: "none" } }), JSON.stringify({ network: { mode: "nope" } })]) {
        const result = await runInFakeDockerProject(["run", "--policy-file", "bad.json", "--image", "fixture-image", "--", "echo", "fixture"], {
          "bad.json": body
        });
        expect(result.outcome).toBe("rejected");
        expect(errorMessage(result.error)).toMatch(/bad\.json/);
        expect(result.calls).toEqual([]);
      }
    });

    it("a wrongly typed or null configured policyFile or adapter fails before any provider call", async () => {
      for (const config of [
        { adapter: "docker", policyFile: ["capsule.policy.json"] },
        { adapter: "docker", policyFile: null },
        { adapter: { name: "e2b" }, policyFile: "capsule.policy.json" },
        { adapter: null },
        { receipts: { path: 7 } },
        { receipts: "receipts.jsonl" }
      ]) {
        const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
          "capsule.config.json": config,
          "capsule.policy.json": { network: { mode: "none" } }
        });
        expect(result.outcome, JSON.stringify(config)).toBe("rejected");
        expect(errorMessage(result.error)).toMatch(/capsule\.config\.json (adapter|policyFile|receipts)/);
        expect(result.calls).toEqual([]);
      }
    });

    it("an unreadable capsule.config.json fails instead of being treated as absent", async () => {
      const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
        "capsule.config.json": asDirectory
      });
      expect(result.outcome).toBe("rejected");
      expect(errorMessage(result.error)).toMatch(/Could not read .*capsule\.config\.json/);
      expect(result.calls).toEqual([]);
    });

    it("a misspelled or wrongly typed field inside a policy section fails before any provider call", async () => {
      for (const body of [
        { network: { mode: "none" }, approvals: { requried: true } },
        { approvals: { required: "yes" } },
        { secrets: { alowed: [] } },
        { secrets: { redactionProfile: "loose" } },
        { limits: { timeoutMS: 10 } },
        { limits: { timeoutMs: "10" } },
        { network: { mode: "allowlist", allowedHost: ["example.com"] } }
      ]) {
        const result = await runInFakeDockerProject(["run", "--image", "fixture-image", "--", "echo", "fixture"], {
          "capsule.config.json": { adapter: "docker", policyFile: "capsule.policy.json" },
          "capsule.policy.json": body
        });
        expect(result.outcome, JSON.stringify(body)).toBe("rejected");
        expect(errorMessage(result.error)).toMatch(/capsule\.policy\.json/);
        expect(result.calls).toEqual([]);
      }
    });

    it("policy explain and run read the same effective policy", async () => {
      const result = await runInFakeDockerProject(["policy", "explain", "--capability", "job.run", "--json"], {
        "capsule.config.json": { policyFile: "capsule.policy.json" },
        "capsule.policy.json": denyPolicy
      });
      expect(result.outcome).toBe("resolved");
      expect(JSON.parse(result.logs[0] ?? "{}")).toMatchObject({ policy: { decision: "denied" } });
    });

    it("preview children receive the effective policy", async () => {
      const preview = {
        name: "audit",
        allowMockProviders: true,
        databases: [{ adapter: "mock-neon", spec: { project: "app", name: "audit-db" } }]
      };
      const withoutPolicy = await runInFakeDockerProject(["preview", "create", "--config-file", "preview.json"], { "preview.json": preview });
      expect(withoutPolicy.outcome).toBe("resolved");

      const result = await runInFakeDockerProject(["preview", "create", "--config-file", "preview.json"], {
        "capsule.config.json": { policyFile: "capsule.policy.json" },
        "capsule.policy.json": denyPolicy,
        "preview.json": preview
      });
      expect(result.outcome).toBe("rejected");
      expect(errorMessage((result.error as Error).cause)).toMatch(/fixture-deny-before-execution|approval/i);
    });
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
    it("runs the advertised branch-create shape against Neon with no adapter flag", async () => {
      const calls: FetchCall[] = [];
      const result = await runInFakeDockerProject(["neon", "branch-create", "--project", "audit", "--name", "audit"], {}, calls);
      expect(result.outcome).toBe("resolved");
      expect(calls).toEqual([{ method: "POST", url: "https://console.neon.tech/api/v2/projects/audit/branches" }]);
      expect(JSON.parse(result.logs[0] ?? "{}")).toMatchObject({ id: "br_fixture", provider: "neon", project: "audit" });
      expect(result.calls).toEqual([]);
    });

    it("runs the advertised branch-delete shape against Neon with no adapter flag", async () => {
      const calls: FetchCall[] = [];
      const result = await runInFakeDockerProject(["neon", "branch-delete", "--project", "audit", "--branch-id", "br_xxx", "--hard-delete"], {}, calls);
      expect(result.outcome).toBe("resolved");
      expect(calls).toEqual([{ method: "DELETE", url: "https://console.neon.tech/api/v2/projects/audit/branches/br_xxx?hard_delete=true" }]);
      expect(result.calls).toEqual([]);
    });

    it("rejects a contradictory --adapter instead of rerouting", async () => {
      const calls: FetchCall[] = [];
      const result = await runInFakeDockerProject(["neon", "branch-create", "--adapter", "docker", "--project", "audit", "--name", "audit"], {}, calls);
      expect(result.outcome).toBe("rejected");
      expect(errorMessage(result.error)).toMatch(/neon commands require the neon adapter, but --adapter selects "docker"/);
      expect(calls).toEqual([]);
      expect(result.calls).toEqual([]);
    });

    it("rejects a contradictory configured adapter, and an explicit --adapter neon overrides it", async () => {
      const calls: FetchCall[] = [];
      const files = { "capsule.config.json": { adapter: "docker" } };
      const rejected = await runInFakeDockerProject(["neon", "branch-create", "--project", "audit", "--name", "audit"], files, calls);
      expect(rejected.outcome).toBe("rejected");
      expect(errorMessage(rejected.error)).toMatch(/capsule\.config\.json selects "docker"/);
      expect(calls).toEqual([]);

      const accepted = await runInFakeDockerProject(["neon", "branch-create", "--adapter", "neon", "--project", "audit", "--name", "audit"], files, calls);
      expect(accepted.outcome).toBe("resolved");
      expect(calls).toHaveLength(1);
    });

    it("accepts the mock-neon adapter for offline use", async () => {
      const calls: FetchCall[] = [];
      const result = await runInFakeDockerProject(["neon", "branch-create", "--adapter", "mock-neon", "--project", "audit", "--name", "audit"], {}, calls);
      expect(result.outcome).toBe("resolved");
      expect(calls).toEqual([]);
    });
  });
});
