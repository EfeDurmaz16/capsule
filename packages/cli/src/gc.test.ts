// capsule gc through the real entry point, with a fake `docker` on PATH that keeps one labelled container
// until it is removed. No container runs. The job lease of a crashed run is written the way JobLeases does.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const entry = realpathSync(fileURLToPath(new URL("./index.ts", import.meta.url)));
const tsx = createRequire(import.meta.url).resolve("tsx");
const sourcePathMap = fileURLToPath(new URL("../../../tsconfig.typecheck.json", import.meta.url));
const id = "d".repeat(64);

const fakeDocker = `#!/bin/sh
printf '%s\\n' "$*" >> "$CAPSULE_FAKE_DOCKER_LOG"
case "$1" in
  version) printf '27.0.0\\n' ;;
  ps) if [ -f "$CAPSULE_FAKE_PRESENT" ]; then cat "$CAPSULE_FAKE_PRESENT"; fi ;;
  inspect) printf '2026-11-08T10:00:00Z\\n' ;;
  rm) rm -f "$CAPSULE_FAKE_PRESENT" ;;
  *) exit 93 ;;
esac
`;

const root = mkdtempSync(join(tmpdir(), "capsule-cli-gc-"));
const callLog = join(root, "docker-calls.txt");
const present = join(root, "present.txt");
const stateDir = join(root, "state");
const leaseDir = join(stateDir, "jobs");
writeFileSync(join(root, "docker"), fakeDocker, "utf8");
chmodSync(join(root, "docker"), 0o755);
afterAll(() => rmSync(root, { recursive: true, force: true }));

function capsule(args: string[]) {
  writeFileSync(callLog, "", "utf8");
  const base: Record<string, string | undefined> = { ...process.env, CI: undefined, NO_COLOR: undefined, FORCE_COLOR: undefined };
  const result = spawnSync(process.execPath, ["--import", tsx, entry, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...base,
      TSX_TSCONFIG_PATH: sourcePathMap,
      PATH: `${root}:/usr/bin:/bin`,
      CAPSULE_FAKE_DOCKER_LOG: callLog,
      CAPSULE_FAKE_PRESENT: present,
      CAPSULE_STATE_DIR: stateDir
    }
  });
  const dockerCalls = readFileSync(callLog, "utf8").split("\n").filter(Boolean);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, dockerCalls };
}

function writeLease(job: string, pid: number, endedAt?: string): void {
  mkdirSync(leaseDir, { recursive: true });
  writeFileSync(
    join(leaseDir, `${job}.json`),
    JSON.stringify({ job, host: hostname(), pid, startedAt: "2026-11-08T10:00:00.000Z", adapter: "docker", ...(endedAt ? { endedAt } : {}) })
  );
}

function lease(job: string, pid: number): void {
  writeLease(job, pid);
  writeFileSync(present, `${id}\top_1\t${job}\t\tcreated\t2026-11-08 10:00:00 +0000 UTC\n`);
}

// A pid that has exited: the run that held the lease was killed.
const deadPid = spawnSync("true").pid!;

describe.skipIf(process.platform === "win32")("capsule gc", () => {
  beforeEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(present, { force: true });
  });

  it("--dry-run reports the residual of a killed run and changes nothing", () => {
    lease("job_killed", deadPid);
    const result = capsule(["gc", "--dry-run", "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { residuals: Array<{ verdict: string; resource: { id: string; job: string } }> };
    expect(report.residuals).toEqual([expect.objectContaining({ verdict: "exited", resource: expect.objectContaining({ id, job: "job_killed" }) })]);
    expect(result.dockerCalls.some((call) => call.startsWith("rm"))).toBe(false);
  });

  it("without --yes and without a terminal it asks for consent and removes nothing", () => {
    lease("job_killed", deadPid);
    const result = capsule(["gc"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--yes");
    expect(result.dockerCalls.some((call) => call.startsWith("rm"))).toBe(false);
  });

  it("--yes removes it under a fresh grant, writes a receipt, observes it gone and forgets the lease", () => {
    lease("job_killed", deadPid);
    const receipts = join(root, "receipts.jsonl");
    const result = capsule(["gc", "--yes", "--json", "--reason", "crash", "--receipt-file", receipts]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { results: Array<{ outcome: string; approval: string; receipts: string[] }> };
    expect(report.results).toEqual([expect.objectContaining({ outcome: "removed", approval: expect.stringMatching(/^gc_/) })]);
    expect(result.dockerCalls.filter((call) => call.startsWith("rm"))).toEqual([`rm -f ${id}`]);
    const written = readFileSync(receipts, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; type: string; metadata: Record<string, string> });
    expect(written.map((receipt) => [receipt.type, receipt.metadata.gc, receipt.metadata.reason])).toEqual([["sandbox.destroy", "exited", "crash"]]);
    expect(report.results[0]?.receipts).toEqual([written[0]?.id]);
    expect(existsSync(join(leaseDir, "job_killed.json"))).toBe(false);
  });

  it("keeps the resource of a run that is still going", () => {
    lease("job_running", process.pid);
    const result = capsule(["gc", "--yes", "--json"]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { residuals: unknown[]; kept: Array<{ verdict: string }> };
    expect(report.residuals).toEqual([]);
    expect(report.kept).toEqual([expect.objectContaining({ verdict: "live" })]);
    expect(result.dockerCalls.some((call) => call.startsWith("rm"))).toBe(false);
  });

  it("forgets the lease of a finished run that left nothing, and keeps it on --dry-run", () => {
    // A run that failed before its create (Docker down, image absent, policy denial) and one killed before it.
    writeLease("job_failed", deadPid, "2026-11-08T10:00:01.000Z");
    writeLease("job_killed", deadPid);
    writeLease("job_running", process.pid);
    expect(capsule(["gc", "--dry-run", "--json"]).status).toBe(0);
    expect(existsSync(join(leaseDir, "job_failed.json"))).toBe(true);
    const result = capsule(["gc", "--yes", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(leaseDir, "job_failed.json"))).toBe(false);
    expect(existsSync(join(leaseDir, "job_killed.json"))).toBe(false);
    expect(existsSync(join(leaseDir, "job_running.json"))).toBe(true);
    expect(result.dockerCalls.some((call) => call.startsWith("rm"))).toBe(false);
  });

  it("job run creates under a lease with owner labels, the same as capsule run", () => {
    const result = capsule(["job", "run", "--adapter", "docker", "--image", "busybox", "--", "echo", "hi"]);
    const run = result.dockerCalls.find((call) => call.startsWith("run "));
    expect(run, result.stderr).toMatch(/--label capsule_operation=op_[0-9a-f]{32} --label capsule_job=job_[0-9a-f]{32}/);
  });
});
