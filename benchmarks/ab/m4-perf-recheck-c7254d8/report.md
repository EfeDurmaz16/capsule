# Interleaved A/B: m4-perf-recheck-c7254d8

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 30.

A (anchor) 7d3a28a8c0e9b9282b1079ea3d2fc61c32c6f8f7 packages tree 66b109a5e72fdc418d86eb0b060443863ebcf346; B (candidate) c7254d825407e784674523b12313e8124ec7f061 packages tree 97fbe32be7f65a59b01329bc5d49ff98b29b4a59.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 6.0/6.6/6.9, at end 4.9/5.8/6.4.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p50 | 53.209 | 3.762 | 0.071 | 0.063 to 0.073 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p95 | 54.068 | 4.183 | 0.077 | 0.076 to 0.078 | better |
| perf-01-core-receipts | parallel-required-delayed-a | process.maxRssBytes | 54968320 | 54886400 | 0.999 | 0.998 to 0.999 | better |
| perf-01-core-receipts | parallel-required-delayed-a | childWallMs | 2164 | 2174 | 1.004 | 1.001 to 1.006 | worse |
| perf-03-aws-client-reuse | ecs-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ecs-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-owned-client | firstCallMs | 2.096 | 2.085 | 1.015 | 0.973 to 1.030 | no difference |
| perf-03-aws-client-reuse | ecs-owned-client | warmCallMedianMs | 0.051 | 0.007 | 0.130 | 0.126 to 0.132 | better |
| perf-03-aws-client-reuse | ecs-owned-client | process.maxRssBytes | 80125952 | 76857344 | 0.959 | 0.958 to 0.962 | better |
| perf-03-aws-client-reuse | ecs-owned-client | childWallMs | 111 | 94.604 | 0.865 | 0.819 to 0.910 | better |
| perf-04-vercel-log-streams | idle-limit-10 | settleMs | 3002 | 3002 | 1.000 | 1.000 to 1.000 | no difference |
| perf-04-vercel-log-streams | idle-limit-10 | process.maxRssBytes | 60186624 | 59785216 | 0.994 | 0.992 to 0.995 | better |
| perf-04-vercel-log-streams | idle-limit-10 | childWallMs | 3044 | 3057 | 1.003 | 1.003 to 1.005 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | changed |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | elapsedMs | 744 | 191 | 0.257 | 0.255 to 0.258 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | leakedSecrets | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | process.maxRssBytes | 141565952 | 142573568 | 1.007 | 1.006 to 1.009 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | childWallMs | 1042 | 481 | 0.462 | 0.458 to 0.467 | better |
| perf-11-jsonl-read | read-50k | receiptsRead | 50000 | 50000 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | fileBytes | 21883890 | 21883890 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | peakRssGrowthBytes | 88203264 | 59310080 | 0.672 | 0.672 to 0.673 | better |
| perf-11-jsonl-read | read-50k | elapsedMs | 60.126 | 57.14 | 0.955 | 0.931 to 0.991 | better |
| perf-11-jsonl-read | read-50k | heapUsedWhileHeldBytes | 80613872 | 43722712 | 0.542 | 0.542 to 0.542 | better |
| perf-11-jsonl-read | read-50k | process.maxRssBytes | 172302336 | 144293888 | 0.837 | 0.837 to 0.838 | better |
| perf-11-jsonl-read | read-50k | childWallMs | 205 | 189 | 0.927 | 0.904 to 0.967 | better |
