# M1 benchmark: before and after

All numbers come from the unchanged harness in `benchmarks/` (`node benchmarks/run.mjs`, workload default repetitions, no `--large`). Every workload is mock or synthetic: injected fake provider clients, a local fake `docker` executable and generated files. No provider was contacted. Nothing here is a cloud latency or throughput claim.

Host for every run: darwin 25.6.0 arm64, Apple M5 Pro, 18 CPUs, 48 GiB, Node v22.23.2. No other build, test or benchmark ran during the runs; ordinary desktop applications stayed open (load average about 5 to 6).

## Data

| Run                           | Source                                                                                                         | Raw data                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Baseline recorded             | 7d3a28a packages (harness commit f0e897e), recorded earlier on 27 Oct 2026                                     | `benchmarks/raw/baseline-7d3a28a/`, `benchmarks/results/baseline-7d3a28a.txt`       |
| After                         | 85506c1 (integrated M1 branch), built with `pnpm build`                                                        | `benchmarks/after/raw/after-85506c1/`, `benchmarks/after/results-after-85506c1.txt` |
| Same-session baseline control | 7d3a28a packages (same packages tree hash 66b109a), scratch checkout, run immediately before the after control | `benchmarks/after/control/raw/control-baseline-7d3a28a/`                            |
| Same-session after control    | 85506c1, run immediately after the baseline control                                                            | `benchmarks/after/control/raw/control-after-85506c1/`                               |

The controls exist because wall-time numbers drift with host state between sessions. Compare timings within the same session (the two control columns). Counts and bounds are deterministic and agree across all runs.

## Reading the results

- Constructor counts (PERF-03, AWS-05): each owned AWS SDK client is constructed once per adapter instead of once per operation (50 to 1 for 50 operations). Injected clients are still used as given. This is a constructor count with intercepted `send`; it says nothing about TLS or cloud latency.
- Complexity and resource counts: completed receipts are no longer retained by a live sandbox (20000 to 1 reachable, PERF-01/CORE-01); in-flight bookkeeping per operation drops from about 2.1 KB to under 7 bytes (CORE-02); a sibling's failed write no longer rejects the other operation (40 to 0); a 16 MiB file under `maxBytes: 1` reads 0 bytes instead of 16 MiB (PERF-02/IO-01); an endless Vercel runtime log body is cancelled after 3060 bytes instead of 64 MiB (PERF-04); Kubernetes log reads run with at most 4 requests in flight instead of 1 and leak 0 secrets instead of 119 (PERF-05/SVC-01); 100 MiB of Docker output is captured up to the 16 MiB default cap with truncation reported (PERF-10).
- Behavioral observations: B now settles before a stalled A (CORE-02); Kubernetes logs are globally ordered and the newest-N selection is exact (SVC-09); a finite Vercel body returns only `limit` entries; malformed NDJSON lines are counted instead of failing the read. The `idle-limit-10` case still reports `timeout` because the workload sets no `bounds.deadlineMs` and the default capture deadline (60 s) is longer than the harness's 3 s watchdog; the deadline itself is covered by `packages/vercel/src/runtime-logs.test.ts`. CLI stdout digests changed for `help` and `capabilities --json` because the help text and the Docker capability declarations changed on purpose; `completion bash` output is identical.
- Timings (same-session controls): CLI cold start about 400 ms to about 30 ms and peak RSS about 218 MB to about 54 MB (PERF-09, lazy adapter loading); Kubernetes log collection over a fake 5 ms-latency client about 685 ms to about 205 ms because of concurrency 4 (PERF-05, synthetic latency only); core receipt throughput up about 1.6x; Docker 100 MiB output peak RSS about 346 MB to about 114 MB and elapsed 1317 ms to 989 ms. Docker 10 MiB elapsed is unchanged within the session (139 ms vs 140 ms). The recorded baseline's 57 ms for that case came from an earlier, quieter host state, so the recorded-baseline to after comparison of that one timing is not meaningful. No measured timing regressed by more than 1.5x within a session.
- Not measured by this harness: PERF-06, PERF-07, PERF-08, PERF-12, PERF-13 and PERF-14 have no workload here; their evidence is the deterministic package tests named in the M1 dispositions. PERF-11 is measured but its package is unchanged (deferred), and the numbers agree within noise.

## Tables

### Constructor counts (deterministic, mock SDK clients)

| Workload                 | Case                   | Metric              | Baseline recorded (7d3a28a) | After (85506c1) | Same-session baseline control | Same-session after control |
| ------------------------ | ---------------------- | ------------------- | --------------------------- | --------------- | ----------------------------- | -------------------------- |
| perf-03-aws-client-reuse | ec2-owned-client       | uniqueSdkClients    | 50                          | 1               | 50                            | 1                          |
| perf-03-aws-client-reuse | ec2-owned-client       | sendCalls           | 50                          | 50              | 50                            | 50                         |
| perf-03-aws-client-reuse | ec2-injected-client    | uniqueSdkClients    | 0                           | 0               | 0                             | 0                          |
| perf-03-aws-client-reuse | ec2-injected-client    | injectedClientCalls | 50                          | 50              | 50                            | 50                         |
| perf-03-aws-client-reuse | ecs-owned-client       | uniqueSdkClients    | 50                          | 1               | 50                            | 1                          |
| perf-03-aws-client-reuse | ecs-owned-client       | sendCalls           | 50                          | 50              | 50                            | 50                         |
| perf-03-aws-client-reuse | ecs-injected-client    | uniqueSdkClients    | 0                           | 0               | 0                             | 0                          |
| perf-03-aws-client-reuse | ecs-injected-client    | injectedClientCalls | 50                          | 50              | 50                            | 50                         |
| perf-03-aws-client-reuse | lambda-owned-client    | uniqueSdkClients    | 50                          | 1               | 50                            | 1                          |
| perf-03-aws-client-reuse | lambda-owned-client    | sendCalls           | 50                          | 50              | 50                            | 50                         |
| perf-03-aws-client-reuse | lambda-injected-client | uniqueSdkClients    | 0                           | 0               | 0                             | 0                          |
| perf-03-aws-client-reuse | lambda-injected-client | injectedClientCalls | 50                          | 50              | 50                            | 50                         |

### Complexity and resource counts (deterministic, synthetic workloads)

| Workload                    | Case                          | Metric                       | Baseline recorded (7d3a28a) | After (85506c1) | Same-session baseline control | Same-session after control |
| --------------------------- | ----------------------------- | ---------------------------- | --------------------------- | --------------- | ----------------------------- | -------------------------- |
| perf-01-core-receipts       | long-lived-best-effort        | final.receiptsStillReachable | 20000                       | 1               | 20000                         | 1                          |
| perf-01-core-receipts       | long-lived-best-effort        | final.heapBytesPerOperation  | 1854                        | 61.564          | 1855                          | 61.547                     |
| perf-01-core-receipts       | long-lived-required           | final.receiptsStillReachable | 20000                       | 1               | 20000                         | 1                          |
| perf-01-core-receipts       | long-lived-required           | final.heapBytesPerOperation  | 2175                        | 61.149          | 2175                          | 60.857                     |
| perf-01-core-receipts       | parallel-required-failing-a   | outcomes.bRejectedWithAError | 40                          | 0               | 40                            | 0                          |
| perf-01-core-receipts       | parallel-required-failing-a   | outcomes.aRejected           | 40                          | 40              | 40                            | 40                         |
| perf-01-core-receipts       | required-inflight-bookkeeping | heapBytesPerOperation        | 2119                        | 6.72            | 2119                          | 6.742                      |
| perf-01-core-receipts       | required-inflight-bookkeeping | failures                     | 0                           | 0               | 0                             | 0                          |
| perf-02-artifact-collection | large-file-tiny-limit         | bytesRead                    | 16777216                    | 0               | 16777216                      | 0                          |
| perf-02-artifact-collection | large-file-within-budget      | bytesRead                    | 50331648                    | 50331648        | 50331648                      | 50331648                   |
| perf-02-artifact-collection | many-small-files              | collectedFiles               | 1000                        | 1000            | 1000                          | 1000                       |
| perf-04-vercel-log-streams  | finite-array                  | entriesReturned              | 2000                        | 100             | 2000                          | 100                        |
| perf-04-vercel-log-streams  | ndjson-fragmented             | entriesReturned              | 2000                        | 100             | 2000                          | 100                        |
| perf-04-vercel-log-streams  | ndjson-malformed              | entriesReturned              | null                        | 100             | null                          | 100                        |
| perf-04-vercel-log-streams  | endless-limit-10              | bytesEmitted                 | 67109012                    | 3060            | 67109012                      | 3060                       |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | maxOutstandingRequests       | 1                           | 4               | 1                             | 4                          |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | leakedSecrets                | 119                         | 0               | 119                           | 0                          |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | maxOutstandingRequests       | 1                           | 4               | 1                             | 4                          |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | leakedSecrets                | 0                           | 0               | 0                             | 0                          |
| perf-10-docker-output       | stdout-10MiB                  | stdoutLengthReturned         | 10485760                    | 10485760        | 10485760                      | 10485760                   |
| perf-10-docker-output       | stdout-100MiB                 | stdoutLengthReturned         | 104857600                   | 16777216        | 104857600                     | 16777216                   |
| perf-11-jsonl-read          | read-50k                      | receiptsRead                 | 50000                       | 50000           | 50000                         | 50000                      |
| perf-11-jsonl-read          | read-50k                      | fileBytes                    | 21883890                    | 21883890        | 21883890                      | 21883890                   |

### Behavioral observations (synthetic workloads)

| Workload                    | Case                          | Metric                      | Baseline recorded (7d3a28a)                                        | After (85506c1)                                                    | Same-session baseline control                                      | Same-session after control                                         |
| --------------------------- | ----------------------------- | --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| perf-01-core-receipts       | parallel-required-delayed-a   | bSettlesBeforeA             | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-02-artifact-collection | large-file-tiny-limit         | truncationReason            | "maxBytes"                                                         | "maxBytes"                                                         | "maxBytes"                                                         | "maxBytes"                                                         |
| perf-02-artifact-collection | large-file-within-budget      | hashMatches                 | true                                                               | true                                                               | true                                                               | true                                                               |
| perf-02-artifact-collection | many-small-files              | inventoryDigest             | "50758fbb91a29981fc3e90bf25da02b02297172b4e30636792a509ea0b91140d" | "50758fbb91a29981fc3e90bf25da02b02297172b4e30636792a509ea0b91140d" | "50758fbb91a29981fc3e90bf25da02b02297172b4e30636792a509ea0b91140d" | "50758fbb91a29981fc3e90bf25da02b02297172b4e30636792a509ea0b91140d" |
| perf-04-vercel-log-streams  | finite-array                  | outcome                     | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         |
| perf-04-vercel-log-streams  | finite-array                  | entriesWithinLimit          | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-04-vercel-log-streams  | ndjson-fragmented             | outcome                     | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         |
| perf-04-vercel-log-streams  | ndjson-fragmented             | entriesWithinLimit          | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-04-vercel-log-streams  | ndjson-malformed              | outcome                     | "rejected"                                                         | "resolved"                                                         | "rejected"                                                         | "resolved"                                                         |
| perf-04-vercel-log-streams  | ndjson-malformed              | error.name                  | "SyntaxError"                                                      | n/a                                                                | "SyntaxError"                                                      | n/a                                                                |
| perf-04-vercel-log-streams  | endless-limit-10              | outcome                     | "timeout"                                                          | "resolved"                                                         | "timeout"                                                          | "resolved"                                                         |
| perf-04-vercel-log-streams  | endless-limit-10              | bodyCancelled               | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-04-vercel-log-streams  | idle-limit-10                 | outcome                     | "timeout"                                                          | "timeout"                                                          | "timeout"                                                          | "timeout"                                                          |
| perf-04-vercel-log-streams  | idle-limit-10                 | bodyCancelled               | false                                                              | false                                                              | false                                                              | false                                                              |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | globallyAscendingTimestamps | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | matchesGlobalNewestSet      | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | matchesGlobalNewestInOrder  | false                                                              | true                                                               | false                                                              | true                                                               |
| perf-09-cli-cold-start      | help                          | exitCode                    | 0                                                                  | 0                                                                  | 0                                                                  | 0                                                                  |
| perf-09-cli-cold-start      | help                          | stdoutDigest                | "a265d4ba0baf8908d441e4ac311c903b3697c5381cab38d84324121d0931f697" | "f6f9bc642f34e01a016e183eb5d9e70a6fdbb9ea761efff875cd2f2d19fd0b1a" | "a265d4ba0baf8908d441e4ac311c903b3697c5381cab38d84324121d0931f697" | "f6f9bc642f34e01a016e183eb5d9e70a6fdbb9ea761efff875cd2f2d19fd0b1a" |
| perf-09-cli-cold-start      | capabilities-json             | exitCode                    | 0                                                                  | 0                                                                  | 0                                                                  | 0                                                                  |
| perf-09-cli-cold-start      | capabilities-json             | stdoutDigest                | "bf5b808fa910cd4223b348dd3c1c55c04c556a28e487270769c324ca4e5c90a0" | "7ab7f02e223103c39a62cd5add6bf4506f74317a433424b017aa714bc1602037" | "bf5b808fa910cd4223b348dd3c1c55c04c556a28e487270769c324ca4e5c90a0" | "7ab7f02e223103c39a62cd5add6bf4506f74317a433424b017aa714bc1602037" |
| perf-09-cli-cold-start      | preset-list-json              | exitCode                    | 0                                                                  | 0                                                                  | 0                                                                  | 0                                                                  |
| perf-09-cli-cold-start      | preset-list-json              | stdoutDigest                | "dacbc3f2fa6984e9a128b2052b6958f845e6d255498a400792bf9429d89b9feb" | "e43664626562853895670d7edb2fa50f2c96f103be5e34ee64120dfb16c8428f" | "dacbc3f2fa6984e9a128b2052b6958f845e6d255498a400792bf9429d89b9feb" | "e43664626562853895670d7edb2fa50f2c96f103be5e34ee64120dfb16c8428f" |
| perf-09-cli-cold-start      | completion-bash               | exitCode                    | 0                                                                  | 0                                                                  | 0                                                                  | 0                                                                  |
| perf-09-cli-cold-start      | completion-bash               | stdoutDigest                | "6a7531d56d89835aef72147594c2c0f22daef56b5362ce4b70477f62993b6bfc" | "6a7531d56d89835aef72147594c2c0f22daef56b5362ce4b70477f62993b6bfc" | "6a7531d56d89835aef72147594c2c0f22daef56b5362ce4b70477f62993b6bfc" | "6a7531d56d89835aef72147594c2c0f22daef56b5362ce4b70477f62993b6bfc" |
| perf-10-docker-output       | stdout-10MiB                  | outcome                     | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         |
| perf-10-docker-output       | stdout-100MiB                 | outcome                     | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         | "resolved"                                                         |
| perf-11-jsonl-read          | corrupt-line-25000            | outcome                     | "rejected"                                                         | "rejected"                                                         | "rejected"                                                         | "rejected"                                                         |
| perf-11-jsonl-read          | corrupt-line-25000            | errorNamesCorruptLine       | true                                                               | true                                                               | true                                                               | true                                                               |

### Mock/synthetic timings and memory (host-dependent, not cloud latency)

| Workload                    | Case                          | Metric             | Baseline recorded (7d3a28a) | After (85506c1) | Same-session baseline control | Same-session after control |
| --------------------------- | ----------------------------- | ------------------ | --------------------------- | --------------- | ----------------------------- | -------------------------- |
| perf-01-core-receipts       | long-lived-best-effort        | opsPerSecond       | 104634                      | 188162          | 130227                        | 213884                     |
| perf-01-core-receipts       | long-lived-required           | opsPerSecond       | 105618                      | 172353          | 123832                        | 198976                     |
| perf-01-core-receipts       | parallel-required-delayed-a   | bLatencyMs.p50     | 52.531                      | 3.628           | 52.225                        | 3.613                      |
| perf-01-core-receipts       | parallel-required-delayed-a   | bLatencyMs.p95     | 53.044                      | 3.912           | 52.984                        | 3.898                      |
| perf-01-core-receipts       | parallel-required-failing-a   | bLatencyMs.p50     | 6.15                        | 3.57            | 6.871                         | 3.53                       |
| perf-02-artifact-collection | large-file-tiny-limit         | peakRssGrowthBytes | 16859136                    | 49152           | 16859136                      | 49152                      |
| perf-02-artifact-collection | large-file-within-budget      | peakRssGrowthBytes | 50397184                    | 65536           | 50429952                      | 65536                      |
| perf-02-artifact-collection | large-file-within-budget      | elapsedMs          | 21.026                      | 19.746          | 19.324                        | 17.729                     |
| perf-02-artifact-collection | many-small-files              | elapsedMs          | 18.166                      | 21.22           | 16.798                        | 18.405                     |
| perf-03-aws-client-reuse    | ec2-owned-client              | firstCallMs        | 2.297                       | 2.174           | 1.936                         | 1.944                      |
| perf-03-aws-client-reuse    | ec2-owned-client              | warmCallMedianMs   | 0.04                        | 0.006           | 0.04                          | 0.006                      |
| perf-03-aws-client-reuse    | ecs-owned-client              | firstCallMs        | 2.547                       | 2.143           | 2.012                         | 2.015                      |
| perf-03-aws-client-reuse    | ecs-owned-client              | warmCallMedianMs   | 0.052                       | 0.007           | 0.047                         | 0.007                      |
| perf-03-aws-client-reuse    | lambda-owned-client           | firstCallMs        | 3.082                       | 3.088           | 2.818                         | 2.819                      |
| perf-03-aws-client-reuse    | lambda-owned-client           | warmCallMedianMs   | 0.06                        | 0.011           | 0.056                         | 0.01                       |
| perf-04-vercel-log-streams  | finite-array                  | settleMs           | 21.132                      | 20.956          | 17.691                        | 18.585                     |
| perf-04-vercel-log-streams  | ndjson-fragmented             | settleMs           | 35.153                      | 20.654          | 32.185                        | 19.07                      |
| perf-04-vercel-log-streams  | endless-limit-10              | settleMs           | 3001                        | 17.26           | 3001                          | 15.811                     |
| perf-04-vercel-log-streams  | endless-limit-10              | peakRssGrowthBytes | 214171648                   | 9863168         | 211173376                     | 9797632                    |
| perf-04-vercel-log-streams  | idle-limit-10                 | settleMs           | 3001                        | 3001            | 3002                          | 3001                       |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | elapsedMs          | 686                         | 197             | 683                           | 204                        |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | elapsedMs          | 686                         | 170             | 685                           | 173                        |
| perf-09-cli-cold-start      | help                          | wallMs.p50         | 436                         | 35.371          | 404                           | 29.505                     |
| perf-09-cli-cold-start      | help                          | maxRssBytes.p50    | 218071040                   | 54263808        | 220774400                     | 54345728                   |
| perf-09-cli-cold-start      | capabilities-json             | wallMs.p50         | 438                         | 36.425          | 399                           | 30.345                     |
| perf-09-cli-cold-start      | capabilities-json             | maxRssBytes.p50    | 218906624                   | 54427648        | 220184576                     | 54509568                   |
| perf-09-cli-cold-start      | preset-list-json              | wallMs.p50         | 433                         | 36.406          | 401                           | 29.626                     |
| perf-09-cli-cold-start      | preset-list-json              | maxRssBytes.p50    | 218710016                   | 54263808        | 220381184                     | 54345728                   |
| perf-09-cli-cold-start      | completion-bash               | wallMs.p50         | 430                         | 36.364          | 403                           | 29.633                     |
| perf-09-cli-cold-start      | completion-bash               | maxRssBytes.p50    | 218152960                   | 54198272        | 220086272                     | 54312960                   |
| perf-10-docker-output       | stdout-10MiB                  | peakRssGrowthBytes | 44335104                    | 43892736        | 39665664                      | 43876352                   |
| perf-10-docker-output       | stdout-10MiB                  | elapsedMs          | 57.13                       | 151             | 139                           | 140                        |
| perf-10-docker-output       | stdout-100MiB                 | peakRssGrowthBytes | 398229504                   | 114851840       | 345784320                     | 114278400                  |
| perf-10-docker-output       | stdout-100MiB                 | elapsedMs          | 481                         | 1001            | 1317                          | 989                        |
| perf-11-jsonl-read          | read-50k                      | peakRssGrowthBytes | 87359488                    | 86933504        | 87343104                      | 86917120                   |
| perf-11-jsonl-read          | read-50k                      | elapsedMs          | 55.054                      | 56.018          | 51.365                        | 51.613                     |
| perf-11-jsonl-read          | corrupt-line-25000            | peakRssGrowthBytes | 72269824                    | 71909376        | 72204288                      | 71958528                   |

## Interleaved A/B against 7d3a28a (final, 8fdc46c)

This section replaces the per-PR tolerance with the campaign rule: no regression against the pre-campaign anchor `7d3a28a`. Every claim here comes from `benchmarks/ab.mjs`: the anchor build (A) and the candidate build (B, a clean build of `8fdc46c`) run the same workloads in one session, alternating A then B per pair in fresh processes, 20 pairs per case. Each metric is the median of the per-pair ratios B/A with a 95% bootstrap interval. "better" or "worse" needs the whole interval on one side of 1. The host was heavily loaded by other work during the run (load average 18 to 26), which widens the timing intervals; counts and memory are less affected.

Raw data: `benchmarks/ab/final-8fdc46c/` (every run of both sides, `summary.json`, `report.md`), `benchmarks/ab/real-docker-8fdc46c/` (opt-in PERF-14 cases against a local Docker Engine, 15 pairs, local image, no pull, `--network none`) and `benchmarks/ab/survey-cbe11d3/` (the first survey, before the performance pass, 15 pairs).

### Regressions the survey found, and their fixes

| Workload, case, metric            | Survey at cbe11d3 (B/A, 95% CI)                     | Cause                                                                                                                   | Fix                                                                                                                                    | Final (B/A, 95% CI)                                          |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| perf-02 many-small-files elapsed  | 1.10 (1.07 to 1.30)                                 | a 64 KiB buffer and two reads per file                                                                                  | one buffer per walk, stop at a short read (`70cee7f`)                                                                                  | 0.91 (0.75 to 1.18), no difference                           |
| perf-02 many-small-files peak RSS | 1.14 (1.137 to 1.140)                               | same                                                                                                                    | same                                                                                                                                   | 0.999 (0.996 to 1.003), no difference                        |
| perf-10 stdout-10MiB elapsed      | 1.08 (1.04 to 1.10), confirmed in a 25-pair recheck | streaming `TextDecoder`, about 8x slower than `StringDecoder`                                                           | `StringDecoder` again (`44af187`)                                                                                                      | 1.02 (0.97 to 1.09), no difference                           |
| perf-04 finite-array settleMs     | 1.03 (1.01 to 1.08)                                 | `releaseLock()` builds an error whose first use creates a `vm` context (about 1 ms per process)                         | no release of a finished body (`fbae6f0`)                                                                                              | 0.99 (0.89 to 1.08), no difference                           |
| perf-05 40 pods all, peak RSS     | 1.10 (1.10 to 1.11)                                 | 41 MB allocated for 3000 lines: re-sort per source, split per line and pod value, regex match objects, a timer per read | newest window, fast UTC keys, `replaceAll` only when present, one deadline timer, in-place redaction (`0fd7cd3`, `d703d13`, `0e56a1c`) | 1.016 (1.007 to 1.022), see below                            |
| perf-11 read-50k elapsed          | not measured (package unchanged)                    | the first incremental reader was 1.07x in one A/B                                                                       | one parse loop per chunk, 4 MiB chunks for readAll (`22caf9c`, `0700eff`)                                                              | 0.97 (0.86 to 1.09), no difference, at 0.67x peak RSS growth |

### What is left above the anchor, and why

- perf-05 Kubernetes logs, 40 pods all, process peak RSS 1.016 (1.007 to 1.022). The anchor neither redacted every pod's env values (119 leaked secrets) nor ordered lines globally. With garbage collection held off, a warm collection of 3000 lines now allocates about 3.5 MB against the anchor's 3.3 MB; the remaining difference is a one-time first-call cost of about 2.5 MB, mostly code the optimizing compiler produces for the ordering and redaction loops. Elapsed is 0.26x. The limit-20 case shows no difference.
- perf-14 Docker artifacts, process peak RSS 1.003 to 1.029. With 10 or 100 paths the anchor collects one artifact (the SB-07 basename collision overwrote the others) while B collects all of them; at one path the difference is about 0.2 MB of larger modules. The local Docker Engine cases show the same: 0.54x elapsed for 10 paths and 0.39x for 100, with 1.10x and 1.02x process peak RSS.
- perf-10 stdout-10MiB process peak RSS 1.005 (1.000 to 1.009): the interval touches 1; elapsed and capture peak growth show no difference.
- process peak RSS of perf-09 (1.005 to 1.010) and of the cli-verify case (1.13) is the harness parent process, which buffers the CLI's stdout; the CLI's own peak RSS is 0.25x for every perf-09 command and 0.57x for `receipt verify` over 50k receipts.

### Notes on the harness

- Before `8fdc46c`, the A/B passed the CLI entry under `/tmp`, a symlink on macOS, and the CLI then exited 0 without running its command (fixed in the CLI itself in `c09b0c0`). The perf-09 rows of `survey-cbe11d3` therefore measure module import only, on both sides.
- `iterate-50k` has no anchor counterpart; its anchor runs are recorded as errors.

### Headline metrics (final run, 20 pairs; real-docker cases 15 pairs)

| Workload                    | Case                          | Metric                      | A median  | B median  | B/A median | 95% CI         | Verdict       |
| --------------------------- | ----------------------------- | --------------------------- | --------- | --------- | ---------- | -------------- | ------------- |
| perf-01-core-receipts       | long-lived-best-effort        | opsPerSecond                | 82704     | 110292    | 1.452      | 1.394 to 1.702 | better        |
| perf-01-core-receipts       | long-lived-best-effort        | final.heapBytesPerOperation | 1854      | 61.419    | 0.033      | 0.033 to 0.033 | better        |
| perf-01-core-receipts       | long-lived-best-effort        | process.maxRssBytes         | 132300800 | 119586816 | 0.904      | 0.901 to 0.907 | better        |
| perf-01-core-receipts       | long-lived-required           | opsPerSecond                | 74753     | 119912    | 1.442      | 1.336 to 1.601 | better        |
| perf-01-core-receipts       | long-lived-required           | final.heapBytesPerOperation | 2175      | 61.006    | 0.028      | 0.028 to 0.028 | better        |
| perf-01-core-receipts       | long-lived-required           | process.maxRssBytes         | 139132928 | 121241600 | 0.873      | 0.869 to 0.876 | better        |
| perf-01-core-receipts       | parallel-required-delayed-a   | bLatencyMs.p50              | 52.199    | 3.601     | 0.069      | 0.068 to 0.070 | better        |
| perf-01-core-receipts       | parallel-required-delayed-a   | process.maxRssBytes         | 55156736  | 55058432  | 0.997      | 0.995 to 0.998 | better        |
| perf-01-core-receipts       | parallel-required-failing-a   | bLatencyMs.p50              | 6.869     | 3.574     | 0.522      | 0.518 to 0.527 | better        |
| perf-01-core-receipts       | parallel-required-failing-a   | process.maxRssBytes         | 55148544  | 55042048  | 0.998      | 0.997 to 0.999 | better        |
| perf-01-core-receipts       | required-inflight-bookkeeping | heapBytesPerOperation       | 2119      | 6.702     | 0.003      | 0.003 to 0.003 | better        |
| perf-01-core-receipts       | required-inflight-bookkeeping | process.maxRssBytes         | 202973184 | 68845568  | 0.338      | 0.337 to 0.341 | better        |
| perf-02-artifact-collection | large-file-tiny-limit         | bytesRead                   | 16777216  | 0         | 0.000      | 0.000 to 0.000 | better        |
| perf-02-artifact-collection | large-file-tiny-limit         | elapsedMs                   | 2.967     | 0.241     | 0.084      | 0.071 to 0.094 | better        |
| perf-02-artifact-collection | large-file-tiny-limit         | peakRssGrowthBytes          | 16891904  | 49152     | 0.003      | 0.003 to 0.003 | better        |
| perf-02-artifact-collection | large-file-tiny-limit         | process.maxRssBytes         | 65437696  | 48529408  | 0.741      | 0.740 to 0.742 | better        |
| perf-02-artifact-collection | large-file-within-budget      | bytesRead                   | 50331648  | 50331648  | 1.000      | 1.000 to 1.000 | equal         |
| perf-02-artifact-collection | large-file-within-budget      | elapsedMs                   | 27.55     | 22.986    | 0.875      | 0.774 to 0.958 | better        |
| perf-02-artifact-collection | large-file-within-budget      | peakRssGrowthBytes          | 50429952  | 81920     | 0.002      | 0.001 to 0.003 | better        |
| perf-02-artifact-collection | large-file-within-budget      | process.maxRssBytes         | 100196352 | 49905664  | 0.498      | 0.497 to 0.499 | better        |
| perf-02-artifact-collection | many-small-files              | bytesRead                   | 4096000   | 4096000   | 1.000      | 1.000 to 1.000 | equal         |
| perf-02-artifact-collection | many-small-files              | elapsedMs                   | 34.851    | 34.34     | 0.913      | 0.749 to 1.181 | no difference |
| perf-02-artifact-collection | many-small-files              | peakRssGrowthBytes          | 1597440   | 1564672   | 0.990      | 0.959 to 1.036 | no difference |
| perf-02-artifact-collection | many-small-files              | process.maxRssBytes         | 58621952  | 58482688  | 0.999      | 0.996 to 1.003 | no difference |
| perf-03-aws-client-reuse    | ec2-owned-client              | uniqueSdkClients            | 50        | 1         | 0.020      | 0.020 to 0.020 | better        |
| perf-03-aws-client-reuse    | ec2-owned-client              | warmCallMedianMs            | 0.052     | 0.006     | 0.132      | 0.110 to 0.134 | better        |
| perf-03-aws-client-reuse    | ec2-owned-client              | firstCallMs                 | 3.201     | 2.823     | 0.961      | 0.794 to 1.021 | no difference |
| perf-03-aws-client-reuse    | ec2-injected-client           | uniqueSdkClients            | 0         | 0         | 1.000      | 1.000 to 1.000 | equal         |
| perf-03-aws-client-reuse    | ec2-injected-client           | warmCallMedianMs            | 0.006     | 0.006     | 1.015      | 0.958 to 1.037 | no difference |
| perf-03-aws-client-reuse    | ec2-injected-client           | firstCallMs                 | 0.869     | 0.702     | 0.877      | 0.786 to 1.037 | no difference |
| perf-03-aws-client-reuse    | ecs-owned-client              | uniqueSdkClients            | 50        | 1         | 0.020      | 0.020 to 0.020 | better        |
| perf-03-aws-client-reuse    | ecs-owned-client              | warmCallMedianMs            | 0.06      | 0.007     | 0.127      | 0.115 to 0.130 | better        |
| perf-03-aws-client-reuse    | ecs-owned-client              | firstCallMs                 | 3.483     | 3.003     | 0.957      | 0.798 to 1.011 | no difference |
| perf-03-aws-client-reuse    | ecs-injected-client           | uniqueSdkClients            | 0         | 0         | 1.000      | 1.000 to 1.000 | equal         |
| perf-03-aws-client-reuse    | ecs-injected-client           | warmCallMedianMs            | 0.007     | 0.007     | 1.006      | 0.965 to 1.038 | no difference |
| perf-03-aws-client-reuse    | ecs-injected-client           | firstCallMs                 | 0.925     | 0.743     | 1.002      | 0.819 to 1.107 | no difference |
| perf-03-aws-client-reuse    | lambda-owned-client           | uniqueSdkClients            | 50        | 1         | 0.020      | 0.020 to 0.020 | better        |
| perf-03-aws-client-reuse    | lambda-owned-client           | warmCallMedianMs            | 0.074     | 0.012     | 0.172      | 0.129 to 0.181 | better        |
| perf-03-aws-client-reuse    | lambda-owned-client           | firstCallMs                 | 4.208     | 4.525     | 0.984      | 0.940 to 1.113 | no difference |
| perf-03-aws-client-reuse    | lambda-injected-client        | uniqueSdkClients            | 0         | 0         | 1.000      | 1.000 to 1.000 | equal         |
| perf-03-aws-client-reuse    | lambda-injected-client        | warmCallMedianMs            | 0.011     | 0.012     | 1.019      | 0.974 to 1.085 | no difference |
| perf-03-aws-client-reuse    | lambda-injected-client        | firstCallMs                 | 1.941     | 1.918     | 1.044      | 0.845 to 1.110 | no difference |
| perf-04-vercel-log-streams  | finite-array                  | settleMs                    | 26.699    | 26.022    | 0.994      | 0.891 to 1.075 | no difference |
| perf-04-vercel-log-streams  | finite-array                  | peakRssGrowthBytes          | 13672448  | 12951552  | 0.951      | 0.927 to 0.959 | better        |
| perf-04-vercel-log-streams  | finite-array                  | process.maxRssBytes         | 65880064  | 65323008  | 0.992      | 0.985 to 0.995 | better        |
| perf-04-vercel-log-streams  | ndjson-fragmented             | settleMs                    | 52.515    | 30.134    | 0.562      | 0.504 to 0.610 | better        |
| perf-04-vercel-log-streams  | ndjson-fragmented             | peakRssGrowthBytes          | 34078720  | 17637376  | 0.519      | 0.507 to 0.523 | better        |
| perf-04-vercel-log-streams  | ndjson-fragmented             | process.maxRssBytes         | 86515712  | 70041600  | 0.811      | 0.805 to 0.813 | better        |
| perf-04-vercel-log-streams  | ndjson-malformed              | settleMs                    | 47.546    | 24.334    | 0.548      | 0.511 to 0.590 | better        |
| perf-04-vercel-log-streams  | ndjson-malformed              | peakRssGrowthBytes          | 33382400  | 17547264  | 0.525      | 0.515 to 0.532 | better        |
| perf-04-vercel-log-streams  | ndjson-malformed              | process.maxRssBytes         | 85835776  | 69951488  | 0.816      | 0.811 to 0.818 | better        |
| perf-04-vercel-log-streams  | endless-limit-10              | settleMs                    | 3001      | 22.82     | 0.008      | 0.006 to 0.008 | better        |
| perf-04-vercel-log-streams  | endless-limit-10              | peakRssGrowthBytes          | 215048192 | 9355264   | 0.044      | 0.043 to 0.044 | better        |
| perf-04-vercel-log-streams  | endless-limit-10              | process.maxRssBytes         | 265035776 | 59064320  | 0.223      | 0.223 to 0.224 | better        |
| perf-04-vercel-log-streams  | idle-limit-10                 | settleMs                    | 3001      | 3001      | 1.000      | 1.000 to 1.000 | no difference |
| perf-04-vercel-log-streams  | idle-limit-10                 | peakRssGrowthBytes          | 10469376  | 10346496  | 0.991      | 0.976 to 0.998 | better        |
| perf-04-vercel-log-streams  | idle-limit-10                 | process.maxRssBytes         | 60547072  | 60104704  | 0.991      | 0.988 to 0.993 | better        |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | elapsedMs                   | 686       | 183       | 0.266      | 0.256 to 0.273 | better        |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | leakedSecrets               | 119       | 0         | 0.000      | 0.000 to 0.000 | better        |
| perf-05-kubernetes-logs     | 40-pods-3-containers-all      | process.maxRssBytes         | 143917056 | 146161664 | 1.016      | 1.007 to 1.022 | worse         |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | elapsedMs                   | 687       | 174       | 0.256      | 0.249 to 0.258 | better        |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | leakedSecrets               | 0         | 0         | 1.000      | 1.000 to 1.000 | equal         |
| perf-05-kubernetes-logs     | 40-pods-3-containers-limit-20 | process.maxRssBytes         | 142942208 | 143556608 | 1.009      | 0.998 to 1.012 | no difference |
| perf-09-cli-cold-start      | help                          | wallMs.p50                  | 580       | 46.202    | 0.075      | 0.068 to 0.079 | better        |
| perf-09-cli-cold-start      | help                          | maxRssBytes.p50             | 219987968 | 54321152  | 0.247      | 0.246 to 0.248 | better        |
| perf-09-cli-cold-start      | capabilities-json             | wallMs.p50                  | 637       | 49.058    | 0.079      | 0.075 to 0.082 | better        |
| perf-09-cli-cold-start      | capabilities-json             | maxRssBytes.p50             | 221093888 | 54665216  | 0.247      | 0.246 to 0.249 | better        |
| perf-09-cli-cold-start      | preset-list-json              | wallMs.p50                  | 602       | 50.361    | 0.072      | 0.069 to 0.080 | better        |
| perf-09-cli-cold-start      | preset-list-json              | maxRssBytes.p50             | 220766208 | 54386688  | 0.247      | 0.246 to 0.248 | better        |
| perf-09-cli-cold-start      | completion-bash               | wallMs.p50                  | 603       | 43.045    | 0.075      | 0.071 to 0.078 | better        |
| perf-09-cli-cold-start      | completion-bash               | maxRssBytes.p50             | 220692480 | 54329344  | 0.246      | 0.246 to 0.247 | better        |
| perf-10-docker-output       | stdout-10MiB                  | elapsedMs                   | 66.504    | 77.223    | 1.023      | 0.966 to 1.090 | no difference |
| perf-10-docker-output       | stdout-10MiB                  | peakRssGrowthBytes          | 44163072  | 44195840  | 1.004      | 0.991 to 1.011 | no difference |
| perf-10-docker-output       | stdout-10MiB                  | process.maxRssBytes         | 95739904  | 96264192  | 1.005      | 1.000 to 1.009 | worse         |
| perf-10-docker-output       | stdout-100MiB                 | elapsedMs                   | 742       | 154       | 0.202      | 0.192 to 0.221 | better        |
| perf-10-docker-output       | stdout-100MiB                 | peakRssGrowthBytes          | 412041216 | 117694464 | 0.282      | 0.278 to 0.299 | better        |
| perf-10-docker-output       | stdout-100MiB                 | process.maxRssBytes         | 477495296 | 182534144 | 0.382      | 0.378 to 0.390 | better        |
| perf-11-jsonl-read          | read-50k                      | elapsedMs                   | 73.654    | 71.757    | 0.970      | 0.862 to 1.089 | no difference |
| perf-11-jsonl-read          | read-50k                      | peakRssGrowthBytes          | 87973888  | 59252736  | 0.673      | 0.672 to 0.675 | better        |
| perf-11-jsonl-read          | read-50k                      | process.maxRssBytes         | 172253184 | 144703488 | 0.839      | 0.838 to 0.841 | better        |
| perf-11-jsonl-read          | cli-verify-50k                | process.maxRssBytes         | 169213952 | 190652416 | 1.126      | 1.103 to 1.129 | worse         |
| perf-11-jsonl-read          | cli-verify-50k                | wallMs                      | 1093      | 477       | 0.460      | 0.413 to 0.523 | better        |
| perf-11-jsonl-read          | cli-verify-50k                | cliMaxRssBytes              | 404267008 | 229195776 | 0.571      | 0.564 to 0.599 | better        |
| perf-11-jsonl-read          | corrupt-line-25000            | elapsedMs                   | 49.994    | 37.44     | 0.801      | 0.715 to 0.928 | better        |
| perf-11-jsonl-read          | corrupt-line-25000            | peakRssGrowthBytes          | 73023488  | 35758080  | 0.491      | 0.489 to 0.495 | better        |
| perf-11-jsonl-read          | corrupt-line-25000            | process.maxRssBytes         | 152051712 | 115785728 | 0.762      | 0.761 to 0.763 | better        |
| perf-12-sqlite-store        | file-2000-writes              | writeMs                     | 12362     | 4717      | 0.851      | 0.448 to 1.087 | no difference |
| perf-12-sqlite-store        | file-2000-writes              | writePrepareCalls           | 2001      | 1         | 0.000      | 0.000 to 0.000 | better        |
| perf-12-sqlite-store        | file-2000-writes              | readMs                      | 22.35     | 18.701    | 0.895      | 0.761 to 1.144 | no difference |
| perf-12-sqlite-store        | file-2000-writes              | process.maxRssBytes         | 84475904  | 75579392  | 0.871      | 0.843 to 0.902 | better        |
| perf-12-sqlite-store        | memory-2000-writes            | writeMs                     | 21.669    | 9.519     | 0.485      | 0.434 to 0.510 | better        |
| perf-12-sqlite-store        | memory-2000-writes            | writePrepareCalls           | 2001      | 1         | 0.000      | 0.000 to 0.000 | better        |
| perf-12-sqlite-store        | memory-2000-writes            | readMs                      | 21.103    | 19.541    | 0.903      | 0.788 to 1.013 | no difference |
| perf-12-sqlite-store        | memory-2000-writes            | process.maxRssBytes         | 86966272  | 76054528  | 0.875      | 0.872 to 0.875 | better        |
| perf-14-docker-artifacts    | paths-1                       | dockerCpSpawns              | 1         | 1         | 1.000      | 1.000 to 1.000 | equal         |
| perf-14-docker-artifacts    | paths-1                       | elapsedMs                   | 32.732    | 23.462    | 0.855      | 0.767 to 0.995 | better        |
| perf-14-docker-artifacts    | paths-1                       | process.maxRssBytes         | 52420608  | 52609024  | 1.003      | 1.001 to 1.006 | worse         |
| perf-14-docker-artifacts    | paths-10                      | dockerCpSpawns              | 10        | 10        | 1.000      | 1.000 to 1.000 | equal         |
| perf-14-docker-artifacts    | paths-10                      | elapsedMs                   | 148       | 67.5      | 0.460      | 0.420 to 0.569 | better        |
| perf-14-docker-artifacts    | paths-10                      | process.maxRssBytes         | 57409536  | 57704448  | 1.006      | 1.004 to 1.007 | worse         |
| perf-14-docker-artifacts    | paths-100                     | dockerCpSpawns              | 100       | 100       | 1.000      | 1.000 to 1.000 | equal         |
| perf-14-docker-artifacts    | paths-100                     | elapsedMs                   | 1139      | 456       | 0.394      | 0.367 to 0.450 | better        |
| perf-14-docker-artifacts    | paths-100                     | process.maxRssBytes         | 59416576  | 60301312  | 1.014      | 1.010 to 1.016 | worse         |
| perf-14-docker-artifacts    | paths-1-latency-25ms          | dockerCpSpawns              | 1         | 1         | 1.000      | 1.000 to 1.000 | equal         |
| perf-14-docker-artifacts    | paths-1-latency-25ms          | elapsedMs                   | 68.547    | 60.995    | 0.994      | 0.859 to 1.077 | no difference |
| perf-14-docker-artifacts    | paths-1-latency-25ms          | process.maxRssBytes         | 52527104  | 52707328  | 1.003      | 1.002 to 1.005 | worse         |
| perf-14-docker-artifacts    | paths-10-latency-25ms         | dockerCpSpawns              | 10        | 10        | 1.000      | 1.000 to 1.000 | equal         |
| perf-14-docker-artifacts    | paths-10-latency-25ms         | elapsedMs                   | 456       | 172       | 0.358      | 0.342 to 0.427 | better        |
| perf-14-docker-artifacts    | paths-10-latency-25ms         | process.maxRssBytes         | 57319424  | 57868288  | 1.009      | 1.007 to 1.013 | worse         |
| perf-14-docker-artifacts    | paths-100-latency-25ms        | dockerCpSpawns              | 100       | 100       | 1.000      | 1.000 to 1.000 | equal         |
| perf-14-docker-artifacts    | paths-100-latency-25ms        | elapsedMs                   | 5111      | 1532      | 0.308      | 0.262 to 0.384 | better        |
| perf-14-docker-artifacts    | paths-100-latency-25ms        | process.maxRssBytes         | 58630144  | 60284928  | 1.029      | 1.015 to 1.036 | worse         |
| perf-14-docker-artifacts    | real-docker-paths-10          | elapsedMs                   | 578       | 319       | 0.542      | 0.515 to 0.603 | better        |
| perf-14-docker-artifacts    | real-docker-paths-10          | process.maxRssBytes         | 52559872  | 57671680  | 1.098      | 1.095 to 1.103 | worse         |
| perf-14-docker-artifacts    | real-docker-paths-100         | elapsedMs                   | 4483      | 1845      | 0.387      | 0.342 to 0.439 | better        |
| perf-14-docker-artifacts    | real-docker-paths-100         | process.maxRssBytes         | 57753600  | 59736064  | 1.023      | 1.013 to 1.048 | worse         |
