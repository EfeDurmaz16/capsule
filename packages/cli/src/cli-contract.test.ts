// The CLI contract in docs/cli.md, asserted through the real entry point: exit codes, what each stream
// holds, strict parsing, --json, consent without a terminal, and color. Each case starts the CLI as a child
// (source under tsx) from an empty scratch directory with a fake `docker` on PATH, so no container runs and
// no provider is contacted. stdin is a pipe, so every child runs non-interactive.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const entry = realpathSync(fileURLToPath(new URL("./index.ts", import.meta.url)));
const tsx = createRequire(import.meta.url).resolve("tsx");
const sourcePathMap = fileURLToPath(new URL("../../../tsconfig.typecheck.json", import.meta.url));
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

// `docker run` prints one line to each stream and exits 3, like a failing program would.
const fakeDocker = `#!/bin/sh
printf '%s\\n' "$*" >> "$CAPSULE_FAKE_DOCKER_LOG"
case "$1" in
  version) printf '27.0.0\\n' ;;
  run) printf 'program-out\\n'; printf 'program-err\\n' >&2; exit 3 ;;
  *) exit 93 ;;
esac
`;

const root = mkdtempSync(join(tmpdir(), "capsule-cli-contract-"));
const callLog = join(root, "docker-calls.txt");
writeFileSync(join(root, "docker"), fakeDocker, "utf8");
chmodSync(join(root, "docker"), 0o755);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function capsule(args: string[], env: Record<string, string> = {}) {
  writeFileSync(callLog, "", "utf8");
  const base: Record<string, string | undefined> = { ...process.env, CI: undefined, NO_COLOR: undefined, FORCE_COLOR: undefined };
  const result = spawnSync(process.execPath, ["--import", tsx, entry, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...base, TSX_TSCONFIG_PATH: sourcePathMap, PATH: `${root}:/usr/bin:/bin`, CAPSULE_FAKE_DOCKER_LOG: callLog, ...env }
  });
  const dockerCalls = readFileSync(callLog, "utf8").split("\n").filter(Boolean);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, dockerCalls };
}

describe.skipIf(process.platform === "win32")("capsule CLI contract", () => {
  it("--version prints only the version, at any depth", () => {
    expect(capsule(["--version"])).toMatchObject({ status: 0, stdout: `${version}\n`, stderr: "" });
    expect(capsule(["run", "--version"])).toMatchObject({ status: 0, stdout: `${version}\n` });
    expect(JSON.parse(capsule(["--version", "--json"]).stdout)).toEqual({ version });
  });

  it("an unknown command is a usage error (exit 2) with a one-line hint, not help and exit 0", () => {
    const result = capsule(["deploy"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toEqual(['Error: Unknown command "deploy".', "Run capsule --help for usage."]);
  });

  it("an unknown option fails before any work and never falls back to the default adapter", () => {
    const typo = capsule(["capabilities", "--adaptr", "mock-e2b"]);
    expect(typo.status).toBe(2);
    expect(typo.stdout).toBe("");
    expect(typo.stderr).toContain("Unknown option --adaptr for capsule capabilities.");
    expect(typo.stderr).toContain("Did you mean --adapter?");

    const run = capsule(["run", "--adaptr", "e2b", "--", "node", "job.js"]);
    expect(run.status).toBe(2);
    expect(run.dockerCalls).toEqual([]);
  });

  it("strict arguments: stray tokens never join a container command, and options a command does not read fail", () => {
    const stray = capsule(["run", "--image", "busybox", "echo", "hi"]);
    expect(stray.status).toBe(2);
    expect(stray.stderr).toContain("Put the command to run after --.");
    expect(stray.dockerCalls).toEqual([]);
    expect(capsule(["doctor", "--image", "busybox"]).status).toBe(2);
    expect(capsule(["receipt", "frobnicate"]).status).toBe(2);
  });

  it("run keeps the program's stdout and stderr apart and exits with its code; the receipt stays off stdout", () => {
    const result = capsule(["run", "--image", "busybox", "--", "sh", "-c", "work"]);
    expect(result.status).toBe(3);
    expect(result.stdout).toBe("program-out\n");
    expect(result.stderr).toContain("program-err\n");
    expect(result.stderr).toMatch(/capsule: ran on docker, exit 3, receipt \S+/);
    expect(result.dockerCalls.filter((line) => line.startsWith("run "))).toHaveLength(1);
  });

  it("run --json prints one JSON document on stdout and nothing on stderr", () => {
    const result = capsule(["run", "--json", "--image", "busybox", "--", "sh", "-c", "work"]);
    expect(result.status).toBe(3);
    expect(result.stderr).toBe("");
    const document = JSON.parse(result.stdout) as { outcome: string; job: { exitCode: number; stdout: string; stderr: string }; receipt: { id: string } };
    expect(document).toMatchObject({ outcome: "ran", job: { adapter: "docker", exitCode: 3, stdout: "program-out\n", stderr: "program-err\n" } });
    expect(document.receipt.id).toEqual(expect.any(String));
  });

  it("with --json a failure writes nothing to stdout and one JSON line to stderr", () => {
    const result = capsule(["--json", "deploy"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ status: "action_required", reason: "unknown_command", message: 'Unknown command "deploy".' });
  });

  it("doctor checks this machine, so it is ready for docker in an empty directory", () => {
    const result = capsule(["doctor"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ready for docker");
    expect(result.stdout).not.toMatch(/release audit|workspace/i);
  });

  it("a delete without a terminal needs --yes and does nothing until it gets it", () => {
    const args = ["neon", "branch-delete", "--adapter", "mock-neon", "--project", "p", "--branch-id", "br_1"];
    const refused = capsule(args);
    expect(refused.status).toBe(2);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("Add --yes to confirm without a prompt.");
    const json = capsule([...args, "--json"]);
    expect(JSON.parse(json.stderr)).toMatchObject({ status: "action_required", reason: "action_required", userActionRequired: true });
    const confirmed = capsule([...args, "--yes"]);
    expect(confirmed.status).toBe(0);
    expect(JSON.parse(confirmed.stdout)).toMatchObject({ id: "br_1", status: "deleted" });
  });

  it("help goes to stdout and exits 0; a group without an action shows its help", () => {
    for (const args of [["--help"], ["help", "run"], ["run", "-h"], ["receipt"]]) {
      const result = capsule(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage");
      expect(result.stderr).toBe("");
    }
  });

  it("no color when stderr is not a terminal or NO_COLOR is set; FORCE_COLOR turns it on", () => {
    expect(capsule(["deploy"]).stderr).not.toContain("\u001b[");
    expect(capsule(["deploy"], { FORCE_COLOR: "1" }).stderr).toContain("\u001b[31mError:\u001b[39m");
    expect(capsule(["deploy"], { FORCE_COLOR: "1", NO_COLOR: "1" }).stderr).not.toContain("\u001b[");
    expect(capsule(["deploy", "--no-color"], { FORCE_COLOR: "1" }).stderr).not.toContain("\u001b[");
  });
});

describe("failure classes", () => {
  it("maps SDK error codes to stable reasons and every reason to one exit code", async () => {
    const { PolicyViolationError, UnknownOutcomeError, ProviderRateLimitError } = await import("@capsule-sdk/core");
    const { CliError, toCliError, usageError } = await import("./contract.js");
    expect(toCliError(new PolicyViolationError("denied"))).toMatchObject({ reason: "policy_denied", exitCode: 1 });
    expect(toCliError(new UnknownOutcomeError("lost", { operation: "service.deploy" }))).toMatchObject({
      reason: "unknown_outcome",
      exitCode: 1,
      retryable: false,
      data: { operation: "service.deploy" }
    });
    expect(toCliError(new ProviderRateLimitError("slow down", { category: "rate-limit", retryable: true }))).toMatchObject({
      reason: "rate_limited",
      retryable: true
    });
    expect(toCliError(new TypeError("bug"))).toMatchObject({ reason: "internal_error", exitCode: 1 });
    expect(usageError("bad", "missing_value").exitCode).toBe(2);
    expect(new CliError("canceled", "Canceled.").exitCode).toBe(130);
  });
});
