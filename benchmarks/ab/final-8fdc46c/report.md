# Interleaved A/B: final-8fdc46c

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 20.

A (anchor) 7d3a28a8c0e9b9282b1079ea3d2fc61c32c6f8f7 packages tree 66b109a5e72fdc418d86eb0b060443863ebcf346; B (candidate) 8fdc46cb331b811e14950e283d5b825788b5a07e packages tree cf7875190d8205697a7a93db8194dc50e04485b3.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 25.9/17.7/12.8, at end 20.5/19.0/19.4.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-01-core-receipts | long-lived-best-effort | final.receiptsStillReachable | 20000 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | long-lived-best-effort | final.heapBytesPerOperation | 1854 | 61.419 | 0.033 | 0.033 to 0.033 | better |
| perf-01-core-receipts | long-lived-best-effort | opsPerSecond | 82704 | 110292 | 1.452 | 1.394 to 1.702 | better |
| perf-01-core-receipts | long-lived-best-effort | process.maxRssBytes | 132300800 | 119586816 | 0.904 | 0.901 to 0.907 | better |
| perf-01-core-receipts | long-lived-best-effort | childWallMs | 309 | 252 | 0.745 | 0.661 to 0.770 | better |
| perf-01-core-receipts | long-lived-required | final.receiptsStillReachable | 20000 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | long-lived-required | final.heapBytesPerOperation | 2175 | 61.006 | 0.028 | 0.028 to 0.028 | better |
| perf-01-core-receipts | long-lived-required | opsPerSecond | 74753 | 119912 | 1.442 | 1.336 to 1.601 | better |
| perf-01-core-receipts | long-lived-required | process.maxRssBytes | 139132928 | 121241600 | 0.873 | 0.869 to 0.876 | better |
| perf-01-core-receipts | long-lived-required | childWallMs | 335 | 238 | 0.757 | 0.713 to 0.805 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p50 | 52.199 | 3.601 | 0.069 | 0.068 to 0.070 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p95 | 53.226 | 4.099 | 0.076 | 0.073 to 0.080 | better |
| perf-01-core-receipts | parallel-required-delayed-a | process.maxRssBytes | 55156736 | 55058432 | 0.997 | 0.995 to 0.998 | better |
| perf-01-core-receipts | parallel-required-delayed-a | childWallMs | 2146 | 2147 | 1.001 | 0.996 to 1.006 | no difference |
| perf-01-core-receipts | parallel-required-failing-a | outcomes.bRejectedWithAError | 40 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | parallel-required-failing-a | outcomes.aRejected | 40 | 40 | 1.000 | 1.000 to 1.000 | equal |
| perf-01-core-receipts | parallel-required-failing-a | bLatencyMs.p50 | 6.869 | 3.574 | 0.522 | 0.518 to 0.527 | better |
| perf-01-core-receipts | parallel-required-failing-a | process.maxRssBytes | 55148544 | 55042048 | 0.998 | 0.997 to 0.999 | better |
| perf-01-core-receipts | parallel-required-failing-a | childWallMs | 314 | 318 | 0.987 | 0.966 to 1.008 | no difference |
| perf-01-core-receipts | required-inflight-bookkeeping | heapBytesPerOperation | 2119 | 6.702 | 0.003 | 0.003 to 0.003 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | failures | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-01-core-receipts | required-inflight-bookkeeping | process.maxRssBytes | 202973184 | 68845568 | 0.338 | 0.337 to 0.341 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | childWallMs | 497 | 305 | 0.566 | 0.522 to 0.685 | better |
| perf-02-artifact-collection | large-file-tiny-limit | bytesRead | 16777216 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-02-artifact-collection | large-file-tiny-limit | peakRssGrowthBytes | 16891904 | 49152 | 0.003 | 0.003 to 0.003 | better |
| perf-02-artifact-collection | large-file-tiny-limit | process.maxRssBytes | 65437696 | 48529408 | 0.741 | 0.740 to 0.742 | better |
| perf-02-artifact-collection | large-file-tiny-limit | childWallMs | 65.118 | 56.936 | 0.937 | 0.875 to 1.009 | no difference |
| perf-02-artifact-collection | large-file-within-budget | bytesRead | 50331648 | 50331648 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-within-budget | peakRssGrowthBytes | 50429952 | 81920 | 0.002 | 0.001 to 0.003 | better |
| perf-02-artifact-collection | large-file-within-budget | elapsedMs | 27.55 | 22.986 | 0.875 | 0.774 to 0.958 | better |
| perf-02-artifact-collection | large-file-within-budget | process.maxRssBytes | 100196352 | 49905664 | 0.498 | 0.497 to 0.499 | better |
| perf-02-artifact-collection | large-file-within-budget | childWallMs | 194 | 157 | 0.926 | 0.788 to 1.101 | no difference |
| perf-02-artifact-collection | many-small-files | elapsedMs | 34.851 | 34.34 | 0.913 | 0.749 to 1.181 | no difference |
| perf-02-artifact-collection | many-small-files | collectedFiles | 1000 | 1000 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | many-small-files | process.maxRssBytes | 58621952 | 58482688 | 0.999 | 0.996 to 1.003 | no difference |
| perf-02-artifact-collection | many-small-files | childWallMs | 517 | 433 | 0.942 | 0.737 to 1.216 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ec2-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-owned-client | firstCallMs | 3.201 | 2.823 | 0.961 | 0.794 to 1.021 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | warmCallMedianMs | 0.052 | 0.006 | 0.132 | 0.110 to 0.134 | better |
| perf-03-aws-client-reuse | ec2-owned-client | process.maxRssBytes | 134905856 | 133988352 | 1.001 | 0.991 to 1.008 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | childWallMs | 294 | 252 | 0.870 | 0.822 to 0.935 | better |
| perf-03-aws-client-reuse | ec2-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-injected-client | process.maxRssBytes | 135053312 | 134070272 | 1.000 | 0.992 to 1.009 | no difference |
| perf-03-aws-client-reuse | ec2-injected-client | childWallMs | 218 | 212 | 1.009 | 0.973 to 1.074 | no difference |
| perf-03-aws-client-reuse | ecs-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ecs-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-owned-client | firstCallMs | 3.483 | 3.003 | 0.957 | 0.798 to 1.011 | no difference |
| perf-03-aws-client-reuse | ecs-owned-client | warmCallMedianMs | 0.06 | 0.007 | 0.127 | 0.115 to 0.130 | better |
| perf-03-aws-client-reuse | ecs-owned-client | process.maxRssBytes | 80715776 | 77529088 | 0.961 | 0.952 to 0.969 | better |
| perf-03-aws-client-reuse | ecs-owned-client | childWallMs | 135 | 132 | 0.960 | 0.930 to 0.992 | better |
| perf-03-aws-client-reuse | ecs-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-injected-client | process.maxRssBytes | 76767232 | 76578816 | 0.996 | 0.993 to 1.001 | no difference |
| perf-03-aws-client-reuse | ecs-injected-client | childWallMs | 124 | 119 | 0.997 | 0.943 to 1.101 | no difference |
| perf-03-aws-client-reuse | lambda-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | lambda-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-owned-client | firstCallMs | 4.208 | 4.525 | 0.984 | 0.940 to 1.113 | no difference |
| perf-03-aws-client-reuse | lambda-owned-client | warmCallMedianMs | 0.074 | 0.012 | 0.172 | 0.129 to 0.181 | better |
| perf-03-aws-client-reuse | lambda-owned-client | process.maxRssBytes | 83615744 | 79437824 | 0.951 | 0.942 to 0.962 | better |
| perf-03-aws-client-reuse | lambda-owned-client | childWallMs | 151 | 162 | 1.009 | 0.887 to 1.151 | no difference |
| perf-03-aws-client-reuse | lambda-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-injected-client | process.maxRssBytes | 78438400 | 78102528 | 0.997 | 0.994 to 1.001 | no difference |
| perf-03-aws-client-reuse | lambda-injected-client | childWallMs | 118 | 118 | 1.050 | 0.947 to 1.125 | no difference |
| perf-04-vercel-log-streams | finite-array | entriesReturned | 2000 | 100 | 0.050 | 0.050 to 0.050 | changed |
| perf-04-vercel-log-streams | finite-array | settleMs | 26.699 | 26.022 | 0.994 | 0.891 to 1.075 | no difference |
| perf-04-vercel-log-streams | finite-array | process.maxRssBytes | 65880064 | 65323008 | 0.992 | 0.985 to 0.995 | better |
| perf-04-vercel-log-streams | finite-array | childWallMs | 92.31 | 92.647 | 1.009 | 0.971 to 1.084 | no difference |
| perf-04-vercel-log-streams | ndjson-fragmented | entriesReturned | 2000 | 100 | 0.050 | 0.050 to 0.050 | changed |
| perf-04-vercel-log-streams | ndjson-fragmented | settleMs | 52.515 | 30.134 | 0.562 | 0.504 to 0.610 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | process.maxRssBytes | 86515712 | 70041600 | 0.811 | 0.805 to 0.813 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | childWallMs | 122 | 98.659 | 0.846 | 0.790 to 0.890 | better |
| perf-04-vercel-log-streams | ndjson-malformed | process.maxRssBytes | 85835776 | 69951488 | 0.816 | 0.811 to 0.818 | better |
| perf-04-vercel-log-streams | ndjson-malformed | childWallMs | 104 | 88.052 | 0.856 | 0.818 to 0.907 | better |
| perf-04-vercel-log-streams | endless-limit-10 | settleMs | 3001 | 22.82 | 0.008 | 0.006 to 0.008 | better |
| perf-04-vercel-log-streams | endless-limit-10 | bytesEmitted | 67109012 | 3060 | 0.000 | 0.000 to 0.000 | better |
| perf-04-vercel-log-streams | endless-limit-10 | peakRssGrowthBytes | 215048192 | 9355264 | 0.044 | 0.043 to 0.044 | better |
| perf-04-vercel-log-streams | endless-limit-10 | process.maxRssBytes | 265035776 | 59064320 | 0.223 | 0.223 to 0.224 | better |
| perf-04-vercel-log-streams | endless-limit-10 | childWallMs | 3068 | 98.662 | 0.032 | 0.026 to 0.037 | better |
| perf-04-vercel-log-streams | idle-limit-10 | settleMs | 3001 | 3001 | 1.000 | 1.000 to 1.000 | no difference |
| perf-04-vercel-log-streams | idle-limit-10 | process.maxRssBytes | 60547072 | 60104704 | 0.991 | 0.988 to 0.993 | better |
| perf-04-vercel-log-streams | idle-limit-10 | childWallMs | 3058 | 3059 | 0.999 | 0.999 to 1.001 | no difference |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | changed |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | elapsedMs | 686 | 183 | 0.266 | 0.256 to 0.273 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | leakedSecrets | 119 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | process.maxRssBytes | 143917056 | 146161664 | 1.016 | 1.007 to 1.022 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | childWallMs | 1279 | 645 | 0.511 | 0.479 to 0.576 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | changed |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | elapsedMs | 687 | 174 | 0.256 | 0.249 to 0.258 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | leakedSecrets | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | process.maxRssBytes | 142942208 | 143556608 | 1.009 | 0.998 to 1.012 | no difference |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | childWallMs | 991 | 472 | 0.466 | 0.450 to 0.519 | better |
| perf-09-cli-cold-start | help | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | help | wallMs.p50 | 580 | 46.202 | 0.075 | 0.068 to 0.079 | better |
| perf-09-cli-cold-start | help | maxRssBytes.p50 | 219987968 | 54321152 | 0.247 | 0.246 to 0.248 | better |
| perf-09-cli-cold-start | help | process.maxRssBytes | 48103424 | 48570368 | 1.010 | 1.006 to 1.029 | worse |
| perf-09-cli-cold-start | help | childWallMs | 7000 | 576 | 0.078 | 0.071 to 0.093 | better |
| perf-09-cli-cold-start | capabilities-json | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | capabilities-json | wallMs.p50 | 637 | 49.058 | 0.079 | 0.075 to 0.082 | better |
| perf-09-cli-cold-start | capabilities-json | maxRssBytes.p50 | 221093888 | 54665216 | 0.247 | 0.246 to 0.249 | better |
| perf-09-cli-cold-start | capabilities-json | process.maxRssBytes | 48365568 | 48824320 | 1.008 | 1.006 to 1.013 | worse |
| perf-09-cli-cold-start | capabilities-json | childWallMs | 6800 | 574 | 0.086 | 0.079 to 0.090 | better |
| perf-09-cli-cold-start | preset-list-json | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | preset-list-json | wallMs.p50 | 602 | 50.361 | 0.072 | 0.069 to 0.080 | better |
| perf-09-cli-cold-start | preset-list-json | maxRssBytes.p50 | 220766208 | 54386688 | 0.247 | 0.246 to 0.248 | better |
| perf-09-cli-cold-start | preset-list-json | process.maxRssBytes | 48267264 | 48578560 | 1.006 | 1.002 to 1.011 | worse |
| perf-09-cli-cold-start | preset-list-json | childWallMs | 7374 | 599 | 0.087 | 0.075 to 0.098 | better |
| perf-09-cli-cold-start | completion-bash | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | completion-bash | wallMs.p50 | 603 | 43.045 | 0.075 | 0.071 to 0.078 | better |
| perf-09-cli-cold-start | completion-bash | maxRssBytes.p50 | 220692480 | 54329344 | 0.246 | 0.246 to 0.247 | better |
| perf-09-cli-cold-start | completion-bash | process.maxRssBytes | 48332800 | 48562176 | 1.005 | 1.000 to 1.008 | worse |
| perf-09-cli-cold-start | completion-bash | childWallMs | 6379 | 529 | 0.083 | 0.078 to 0.089 | better |
| perf-10-docker-output | stdout-10MiB | stdoutLengthReturned | 10485760 | 10485760 | 1.000 | 1.000 to 1.000 | equal |
| perf-10-docker-output | stdout-10MiB | peakRssGrowthBytes | 44163072 | 44195840 | 1.004 | 0.991 to 1.011 | no difference |
| perf-10-docker-output | stdout-10MiB | elapsedMs | 66.504 | 77.223 | 1.023 | 0.966 to 1.090 | no difference |
| perf-10-docker-output | stdout-10MiB | process.maxRssBytes | 95739904 | 96264192 | 1.005 | 1.000 to 1.009 | worse |
| perf-10-docker-output | stdout-10MiB | childWallMs | 147 | 162 | 1.004 | 0.961 to 1.070 | no difference |
| perf-10-docker-output | stdout-100MiB | stdoutLengthReturned | 104857600 | 16777216 | 0.160 | 0.160 to 0.160 | changed |
| perf-10-docker-output | stdout-100MiB | peakRssGrowthBytes | 412041216 | 117694464 | 0.282 | 0.278 to 0.299 | better |
| perf-10-docker-output | stdout-100MiB | elapsedMs | 742 | 154 | 0.202 | 0.192 to 0.221 | better |
| perf-10-docker-output | stdout-100MiB | process.maxRssBytes | 477495296 | 182534144 | 0.382 | 0.378 to 0.390 | better |
| perf-10-docker-output | stdout-100MiB | childWallMs | 881 | 269 | 0.285 | 0.267 to 0.296 | better |
| perf-11-jsonl-read | read-50k | receiptsRead | 50000 | 50000 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | fileBytes | 21883890 | 21883890 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | peakRssGrowthBytes | 87973888 | 59252736 | 0.673 | 0.672 to 0.675 | better |
| perf-11-jsonl-read | read-50k | elapsedMs | 73.654 | 71.757 | 0.970 | 0.862 to 1.089 | no difference |
| perf-11-jsonl-read | read-50k | heapUsedWhileHeldBytes | 80610572 | 43720848 | 0.542 | 0.542 to 0.543 | better |
| perf-11-jsonl-read | read-50k | process.maxRssBytes | 172253184 | 144703488 | 0.839 | 0.838 to 0.841 | better |
| perf-11-jsonl-read | read-50k | childWallMs | 296 | 311 | 1.020 | 0.958 to 1.105 | no difference |
| perf-11-jsonl-read | iterate-50k | ok runs | 0/20 | 20/20 | | | not available in this build: JsonlReceiptStore.iterate |
| perf-11-jsonl-read | cli-verify-50k | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | cli-verify-50k | cliMaxRssBytes | 404267008 | 229195776 | 0.571 | 0.564 to 0.599 | better |
| perf-11-jsonl-read | cli-verify-50k | wallMs | 1093 | 477 | 0.460 | 0.413 to 0.523 | better |
| perf-11-jsonl-read | cli-verify-50k | process.maxRssBytes | 169213952 | 190652416 | 1.126 | 1.103 to 1.129 | worse |
| perf-11-jsonl-read | cli-verify-50k | childWallMs | 1447 | 764 | 0.556 | 0.509 to 0.617 | better |
| perf-11-jsonl-read | corrupt-line-25000 | peakRssGrowthBytes | 73023488 | 35758080 | 0.491 | 0.489 to 0.495 | better |
| perf-11-jsonl-read | corrupt-line-25000 | process.maxRssBytes | 152051712 | 115785728 | 0.762 | 0.761 to 0.763 | better |
| perf-11-jsonl-read | corrupt-line-25000 | childWallMs | 279 | 257 | 0.954 | 0.896 to 0.993 | better |
| perf-12-sqlite-store | file-2000-writes | writeMs | 12362 | 4717 | 0.851 | 0.448 to 1.087 | no difference |
| perf-12-sqlite-store | file-2000-writes | writePrepareCalls | 2001 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-12-sqlite-store | file-2000-writes | writePrepareMs | 58.552 | 0.035 | 0.001 | 0.001 to 0.001 | better |
| perf-12-sqlite-store | file-2000-writes | writeExecuteMs | 12307 | 4717 | 0.861 | 0.449 to 1.098 | no difference |
| perf-12-sqlite-store | file-2000-writes | readMs | 22.35 | 18.701 | 0.895 | 0.761 to 1.144 | no difference |
| perf-12-sqlite-store | file-2000-writes | process.maxRssBytes | 84475904 | 75579392 | 0.871 | 0.843 to 0.902 | better |
| perf-12-sqlite-store | file-2000-writes | childWallMs | 12465 | 4817 | 0.845 | 0.449 to 1.097 | no difference |
| perf-12-sqlite-store | memory-2000-writes | writeMs | 21.669 | 9.519 | 0.485 | 0.434 to 0.510 | better |
| perf-12-sqlite-store | memory-2000-writes | writePrepareCalls | 2001 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-12-sqlite-store | memory-2000-writes | writePrepareMs | 8.102 | 0.042 | 0.005 | 0.004 to 0.006 | better |
| perf-12-sqlite-store | memory-2000-writes | writeExecuteMs | 13.035 | 9.468 | 0.781 | 0.707 to 0.826 | better |
| perf-12-sqlite-store | memory-2000-writes | readMs | 21.103 | 19.541 | 0.903 | 0.788 to 1.013 | no difference |
| perf-12-sqlite-store | memory-2000-writes | process.maxRssBytes | 86966272 | 76054528 | 0.875 | 0.872 to 0.875 | better |
| perf-12-sqlite-store | memory-2000-writes | childWallMs | 136 | 104 | 0.870 | 0.721 to 0.934 | better |
| perf-14-docker-artifacts | paths-1 | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | elapsedMs | 32.732 | 23.462 | 0.855 | 0.767 to 0.995 | better |
| perf-14-docker-artifacts | paths-1 | process.maxRssBytes | 52420608 | 52609024 | 1.003 | 1.001 to 1.006 | worse |
| perf-14-docker-artifacts | paths-1 | childWallMs | 133 | 127 | 0.959 | 0.852 to 1.070 | no difference |
| perf-14-docker-artifacts | paths-10 | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | paths-10 | elapsedMs | 148 | 67.5 | 0.460 | 0.420 to 0.569 | better |
| perf-14-docker-artifacts | paths-10 | process.maxRssBytes | 57409536 | 57704448 | 1.006 | 1.004 to 1.007 | worse |
| perf-14-docker-artifacts | paths-10 | childWallMs | 298 | 187 | 0.743 | 0.640 to 0.828 | better |
| perf-14-docker-artifacts | paths-100 | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100 | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | paths-100 | elapsedMs | 1139 | 456 | 0.394 | 0.367 to 0.450 | better |
| perf-14-docker-artifacts | paths-100 | process.maxRssBytes | 59416576 | 60301312 | 1.014 | 1.010 to 1.016 | worse |
| perf-14-docker-artifacts | paths-100 | childWallMs | 1357 | 683 | 0.503 | 0.473 to 0.588 | better |
| perf-14-docker-artifacts | paths-1-latency-25ms | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | elapsedMs | 68.547 | 60.995 | 0.994 | 0.859 to 1.077 | no difference |
| perf-14-docker-artifacts | paths-1-latency-25ms | process.maxRssBytes | 52527104 | 52707328 | 1.003 | 1.002 to 1.005 | worse |
| perf-14-docker-artifacts | paths-1-latency-25ms | childWallMs | 174 | 162 | 1.012 | 0.852 to 1.107 | no difference |
| perf-14-docker-artifacts | paths-10-latency-25ms | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10-latency-25ms | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | paths-10-latency-25ms | elapsedMs | 456 | 172 | 0.358 | 0.342 to 0.427 | better |
| perf-14-docker-artifacts | paths-10-latency-25ms | process.maxRssBytes | 57319424 | 57868288 | 1.009 | 1.007 to 1.013 | worse |
| perf-14-docker-artifacts | paths-10-latency-25ms | childWallMs | 587 | 278 | 0.514 | 0.438 to 0.540 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100-latency-25ms | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | paths-100-latency-25ms | elapsedMs | 5111 | 1532 | 0.308 | 0.262 to 0.384 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | process.maxRssBytes | 58630144 | 60284928 | 1.029 | 1.015 to 1.036 | worse |
| perf-14-docker-artifacts | paths-100-latency-25ms | childWallMs | 5537 | 2048 | 0.339 | 0.295 to 0.504 | better |
