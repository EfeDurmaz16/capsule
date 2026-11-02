// Worker RSS while one connection runs many execs with large output (fixture profile, built worker).
// Usage: node retention.mjs <bin.js> <label> <execs>
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hello, request, startWorker } from "../../../../scripts/bridge-worker-client.mjs";
const [, , bin, label, countArg] = process.argv;
const count = Number(countArg ?? 800);
const dir = mkdtempSync(join(tmpdir(), "retention-"));
const config = join(dir, "config.json");
writeFileSync(
  config,
  JSON.stringify({
    binding: { account: "acct-a", project: "proj-1" },
    policy: { images: ["fixture/ok"] },
    approvals: [],
    sandboxes: [{ native_id: "fx-seed", project: "proj-1", owner_job: "01K8W3A00000000000000000J1", status: "ready" }]
  })
);
const worker = startWorker({
  command: process.execPath,
  args: [...(process.env.HEAP_CAP ? [`--max-old-space-size=${process.env.HEAP_CAP}`] : []), bin, "--profile", "fixture", "--config", config],
  env: { PATH: process.env.PATH },
  timeoutMs: 60_000
});
const rssMiB = () => Number(execFileSync("ps", ["-o", "rss=", "-p", String(worker.child.pid)], { encoding: "utf8" }).trim()) / 1024;
worker.send(hello("fixture"));
await worker.next();
const payload = "y".repeat(1_000_000);
const target = { provider: "fixture", scope: { account: "acct-a", project: "proj-1" }, kind: "sandbox", native_id: "fx-seed" };
const samples = [{ execs: 0, rssMiB: rssMiB() }];
for (let i = 1; i <= count; i += 1) {
  worker.send(
    request(i, "sandbox.exec", {
      target,
      params: { argv: ["echo", payload], stdin: null, cwd: null, timeout_ms: 10000, max_output_bytes: 1048576, secret_names: [] }
    })
  );
  let answer;
  try {
    answer = await worker.next();
  } catch {
    const exit = await worker.exit;
    const fatal = /FATAL ERROR: [^\n]*/.exec(worker.stderr())?.[0] ?? null;
    console.log(
      JSON.stringify({
        label,
        node: process.version,
        heapCapMiB: process.env.HEAP_CAP ?? null,
        outputCharsPerExec: 1_000_001,
        samples,
        diedAfterExecs: i - 1,
        exit,
        fatal
      })
    );
    process.exit(0);
  }
  if (answer.type !== "result") throw new Error(JSON.stringify(answer).slice(0, 300));
  if ([50, 200, 400, 800].includes(i)) samples.push({ execs: i, rssMiB: Number(rssMiB().toFixed(1)) });
}
worker.end();
await worker.exit;
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ label, node: process.version, heapCapMiB: process.env.HEAP_CAP ?? null, outputCharsPerExec: 1_000_001, samples }));
