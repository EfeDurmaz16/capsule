// PERF-09 (CLI-02 dependency): CLI cold start wall time and peak RSS for credential-free commands.
// LOCAL: spawns the built CLI with an empty HOME and no provider credentials in the environment.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { percentile, sha256 } from "../lib/measure.mjs";
import { cliEntry } from "../lib/packages.mjs";

const probe = fileURLToPath(new URL("../lib/exit-probe.mjs", import.meta.url));

function coldStart(args, samples) {
  const home = mkdtempSync(join(process.env.CAPSULE_BENCH_SCRATCH ?? tmpdir(), "cli-home-"));
  try {
    const wall = [];
    const rss = [];
    let exitCode;
    let stdoutDigest;
    let stdoutBytes;
    let stable = true;
    for (let i = 0; i < samples; i += 1) {
      const probeOut = join(home, `probe-${i}.json`);
      const started = performance.now();
      const child = spawnSync(process.execPath, ["--import", probe, cliEntry(), ...args], {
        cwd: home,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: home, CAPSULE_BENCH_PROBE_OUT: probeOut, NO_COLOR: "1" },
        timeout: 60_000
      });
      wall.push(performance.now() - started);
      const probed = JSON.parse(readFileSync(probeOut, "utf8"));
      rss.push(probed.maxRssBytes);
      const digest = sha256(child.stdout ?? "");
      if (stdoutDigest !== undefined && digest !== stdoutDigest) stable = false;
      stdoutDigest = digest;
      stdoutBytes = Buffer.byteLength(child.stdout ?? "");
      exitCode = child.status;
    }
    return {
      command: `capsule ${args.join(" ")}`,
      exitCode,
      stdoutBytes,
      stdoutDigest,
      stdoutStableAcrossSamples: stable,
      wallMs: { p50: percentile(wall, 50), p95: percentile(wall, 95), min: Math.min(...wall) },
      maxRssBytes: { p50: percentile(rss, 50), max: Math.max(...rss) }
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const commands = [
  ["help", ["--help"]],
  ["capabilities-json", ["capabilities", "--json"]],
  ["preset-list-json", ["preset", "list", "--json"]],
  ["completion-bash", ["completion", "bash"]]
];

export const workload = {
  id: "perf-09-cli-cold-start",
  perfIds: ["PERF-09"],
  manifestIds: ["CLI-02"],
  description: "CLI cold start: fresh Node process per sample, wall time and peak RSS; stdout digest is the help/report parity check.",
  reps: 3,
  cases: commands.map(([name, args]) => ({
    name,
    description: `capsule ${args.join(" ")} with empty HOME and no credentials, 10 fresh processes per repetition.`,
    params: { args, samples: 10 },
    headline: ["exitCode", "wallMs.p50", "maxRssBytes.p50", "stdoutDigest"],
    run: ({ params }) => coldStart(params.args, params.samples)
  }))
};
