// Preloaded with `node --import` into a CLI cold-start child. On exit it records the process peak RSS
// and uptime to the file named by CAPSULE_BENCH_PROBE_OUT. It does not alter CLI behavior.
import { writeFileSync } from "node:fs";

const out = process.env.CAPSULE_BENCH_PROBE_OUT;
const started = performance.now();
if (out) {
  process.on("exit", (code) => {
    writeFileSync(out, JSON.stringify({ code, maxRssBytes: process.resourceUsage().maxRSS * 1024, uptimeMs: performance.now() - started }));
  });
}
