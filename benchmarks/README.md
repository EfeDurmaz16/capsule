# Benchmarks

Deterministic, synthetic benchmark harness for the M1 correctness and performance workstream. It records how the built packages behave under fixed workloads so the same harness can run, unchanged, before and after a fix.

Everything here is mock or synthetic. Workloads use injected fake provider clients, a local fake `docker` executable (`fixtures/fake-docker`) and generated files. No provider is contacted, no credential is read and no paid resource is created. Numbers describe this harness on the recorded host only; they are not cloud latency or throughput claims.

## Run

```sh
pnpm install --frozen-lockfile
pnpm build
node benchmarks/run.mjs --label <name>
```

Options:

- `--reps N` overrides the per-case repetition count.
- `--only perf-01-core-receipts,perf-05-kubernetes-logs` runs selected workloads.
- `--large` adds opt-in cases that can exhaust memory on small hosts (1000 MiB Docker output).

Each repetition runs in a fresh `node --expose-gc` process, one at a time, so peak RSS belongs to one case and workloads never compete for the host.

## Output

- `raw/<label>/<workload>/<case>.json`: host, runtime, commit, parameters and every repetition.
- `raw/<label>/summary.json`: per-metric median, p95, min and max for numbers; first value plus a consistency flag for behavioral observations.
- `results/<label>.txt`: headline table.

`after/` holds the M1 after run (`after/raw/<label>/`, `after/results-<label>.txt`), same-session baseline and after controls (`after/control/`) and `after/comparison.md`, the before/after table split into constructor counts, complexity and resource counts, behavioral observations and host-dependent timings.

`check-bounds.mjs <summary.json>` checks a summary against deterministic bounds only: retained receipts, bytes read, SDK client constructions, cancelled bodies, byte and concurrency caps, redaction and ordering observations. It prints a machine-readable JSON verdict and exits 1 on any failed bound. A workload missing from the summary is `not-run`, never a pass, and fails when listed in `--require`. Wall time and RSS are never gated because no threshold has been calibrated across hosts. `pnpm bench:bounds` runs the six bounded workloads once (about 10 s locally) and checks them; CI runs it in the `Benchmark bounds` job. `scripts/benchmark-bounds.test.mjs` proves the archived after run passes and the archived clean-main baseline fails the bounds it broke.

`run-gates.mjs` records every repository gate (the CI commands) to a text file, for example `baseline/gates-7d3a28a.txt`.

## Interleaved A/B against the anchor

`ab.mjs` runs the same workloads against two builds in one session and is the evidence for any speed or memory claim: the pre-campaign anchor (A, `7d3a28a`) and a candidate (B). For each pair and each case it runs A, then B, each in a fresh process, so a change in host load hits both sides. Per metric it reports the median of the per-pair ratios B/A with a 95% bootstrap interval (10000 resamples of pairs, fixed seed) next to the A and B medians. A verdict of better or worse needs the whole interval on one side of 1 and is given only for cost metrics (time, memory, bytes read, process spawns, statement preparations, SDK clients, leaks) and throughput; other counts are "changed" or "same".

```sh
anchor=$(mktemp -d) && git archive 7d3a28a | tar -x -C "$anchor" && (cd "$anchor" && pnpm install --frozen-lockfile && pnpm build)
candidate=$(mktemp -d) && git archive HEAD | tar -x -C "$candidate" && (cd "$candidate" && pnpm install --frozen-lockfile && pnpm build)
node benchmarks/ab.mjs --label <name> --pairs 15 \
  --anchor-packages "$anchor/packages" --anchor-commit 7d3a28a \
  --candidate-packages "$candidate/packages" --candidate-commit HEAD
```

Results land in `ab/<label>/`: `report.md` (headline table), `summary.json` (every metric) and `raw/` (every run of both sides). Workload cases marked `requiresEnv` run only when that variable is set; for example `CAPSULE_BENCH_REAL_DOCKER_IMAGE=<local image>` adds the perf-14 cases against a real local Docker Engine (never pulls, `--network none`).

## Workloads

| Workload                      | Manifest                  | What it measures                                                                                                                                                                                            |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perf-01-core-receipts`       | PERF-01, CORE-01, CORE-02 | Long-lived sandbox: reachable receipts, heap and RSS as operations grow; required persistence with a delayed or failing sibling: B latency p50/p95, isolation; heap per operation for in-flight bookkeeping |
| `perf-02-artifact-collection` | PERF-02, IO-01            | Bytes actually read and peak RSS for a 16 MiB file under `maxBytes: 1`; large in-budget file hash parity; many small files inventory digest                                                                 |
| `perf-03-aws-client-reuse`    | PERF-03, AWS-05           | SDK client constructions for N operations per adapter (real SDK classes, intercepted `send`); injected client ownership                                                                                     |
| `perf-04-vercel-log-streams`  | PERF-04, EDGE-02, EDGE-03 | Finite, fragmented, malformed, endless and idle runtime log bodies: completion, limit, body cancellation, memory                                                                                            |
| `perf-05-kubernetes-logs`     | PERF-05, SVC-01, SVC-09   | 40 pods x 3 containers: max outstanding requests, elapsed, global order, newest-limit selection, redaction                                                                                                  |
| `perf-09-cli-cold-start`      | PERF-09                   | CLI cold start wall time and peak RSS; stdout digest as output parity                                                                                                                                       |
| `perf-10-docker-output`       | PERF-10                   | Docker exec output capture at 10/100 MiB (1000 MiB with `--large`): returned size and peak RSS                                                                                                              |
| `perf-11-jsonl-read`          | PERF-11                   | JSONL `readAll` and `iterate` over 50k receipts: peak RSS, elapsed, corruption line location; `capsule receipt verify` wall time, CLI peak RSS and report digest                                            |
| `perf-12-sqlite-store`        | PERF-12                   | SQLite store writes and reads on a file and on `:memory:`: statement preparations and their time, execution time, synchronous commit cost (file minus memory), ordering and replacement parity              |
| `perf-14-docker-artifacts`    | PERF-14, SB-07, IO-01     | Docker sandbox artifacts for 1, 10 and 100 paths: `docker cp` spawns, bytes, elapsed and SB-07 layout parity, without and with a modelled 25 ms CLI round trip                                              |

Behavioral fields (for example `bSettlesBeforeA`, `bodyCancelled`, `matchesGlobalNewestSet`) are observations, not assertions: the baseline run records current defects as data. Elapsed-time numbers are not CI gates until calibrated; resource counts and bounds are the deterministic signals.
