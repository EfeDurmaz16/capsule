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

`run-gates.mjs` records every repository gate (the CI commands) to a text file, for example `baseline/gates-7d3a28a.txt`.

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
| `perf-11-jsonl-read`          | PERF-11                   | JSONL `readAll` over 50k receipts: peak RSS, elapsed, corruption line location                                                                                                                              |

Behavioral fields (for example `bSettlesBeforeA`, `bodyCancelled`, `matchesGlobalNewestSet`) are observations, not assertions: the baseline run records current defects as data. Elapsed-time numbers are not CI gates until calibrated; resource counts and bounds are the deterministic signals.
