# Interleaved A/B: survey-cbe11d3

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 15.

A (anchor) 7d3a28a8c0e9b9282b1079ea3d2fc61c32c6f8f7 packages tree 66b109a5e72fdc418d86eb0b060443863ebcf346; B (candidate) cbe11d3a7655196ad3871ad930176a8847225eb0 packages tree 56576949d4a805fe7008356ecbb6c9a6c64f8161.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 11.3/10.9/7.8, at end 10.5/10.2/9.0.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only when the whole interval is on one side of 1.

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-01-core-receipts | long-lived-best-effort | final.receiptsStillReachable | 20000 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | long-lived-best-effort | final.heapBytesPerOperation | 1854 | 61.43 | 0.033 | 0.033 to 0.033 | better |
| perf-01-core-receipts | long-lived-best-effort | opsPerSecond | 112501 | 167284 | 1.593 | 1.429 to 1.712 | better |
| perf-01-core-receipts | long-lived-best-effort | process.maxRssBytes | 132431872 | 120209408 | 0.906 | 0.903 to 0.911 | better |
| perf-01-core-receipts | long-lived-best-effort | childWallMs | 224 | 170 | 0.757 | 0.647 to 0.777 | better |
| perf-01-core-receipts | long-lived-required | final.receiptsStillReachable | 20000 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | long-lived-required | final.heapBytesPerOperation | 2176 | 61.378 | 0.028 | 0.028 to 0.028 | better |
| perf-01-core-receipts | long-lived-required | opsPerSecond | 100640 | 163031 | 1.603 | 1.412 to 1.676 | better |
| perf-01-core-receipts | long-lived-required | process.maxRssBytes | 139280384 | 120635392 | 0.868 | 0.864 to 0.870 | better |
| perf-01-core-receipts | long-lived-required | childWallMs | 245 | 167 | 0.679 | 0.664 to 0.757 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p50 | 52.429 | 3.6 | 0.069 | 0.068 to 0.069 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p95 | 52.875 | 3.862 | 0.073 | 0.072 to 0.074 | better |
| perf-01-core-receipts | parallel-required-delayed-a | process.maxRssBytes | 55050240 | 54984704 | 0.998 | 0.997 to 0.999 | better |
| perf-01-core-receipts | parallel-required-delayed-a | childWallMs | 2133 | 2131 | 0.998 | 0.997 to 1.000 | no difference |
| perf-01-core-receipts | parallel-required-failing-a | outcomes.bRejectedWithAError | 40 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | parallel-required-failing-a | outcomes.aRejected | 40 | 40 | 1.000 | 1.000 to 1.000 | equal |
| perf-01-core-receipts | parallel-required-failing-a | bLatencyMs.p50 | 6.89 | 3.558 | 0.513 | 0.507 to 0.541 | better |
| perf-01-core-receipts | parallel-required-failing-a | process.maxRssBytes | 55099392 | 54935552 | 0.996 | 0.995 to 0.998 | better |
| perf-01-core-receipts | parallel-required-failing-a | childWallMs | 309 | 304 | 0.988 | 0.981 to 0.995 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | heapBytesPerOperation | 2119 | 6.721 | 0.003 | 0.003 to 0.003 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | failures | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-01-core-receipts | required-inflight-bookkeeping | process.maxRssBytes | 203112448 | 69042176 | 0.339 | 0.336 to 0.341 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | childWallMs | 408 | 230 | 0.558 | 0.524 to 0.566 | better |
| perf-02-artifact-collection | large-file-tiny-limit | bytesRead | 16777216 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-02-artifact-collection | large-file-tiny-limit | peakRssGrowthBytes | 16891904 | 49152 | 0.003 | 0.003 to 0.003 | better |
| perf-02-artifact-collection | large-file-tiny-limit | process.maxRssBytes | 65372160 | 48431104 | 0.741 | 0.741 to 0.742 | better |
| perf-02-artifact-collection | large-file-tiny-limit | childWallMs | 42.774 | 43.315 | 0.981 | 0.869 to 1.023 | no difference |
| perf-02-artifact-collection | large-file-within-budget | bytesRead | 50331648 | 50331648 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-within-budget | peakRssGrowthBytes | 50429952 | 65536 | 0.001 | 0.001 to 0.002 | better |
| perf-02-artifact-collection | large-file-within-budget | elapsedMs | 21.274 | 19.652 | 0.924 | 0.865 to 0.929 | better |
| perf-02-artifact-collection | large-file-within-budget | process.maxRssBytes | 100106240 | 49725440 | 0.497 | 0.496 to 0.499 | better |
| perf-02-artifact-collection | large-file-within-budget | childWallMs | 105 | 103 | 0.979 | 0.844 to 1.132 | no difference |
| perf-02-artifact-collection | many-small-files | elapsedMs | 19.872 | 23.526 | 1.099 | 1.069 to 1.301 | worse |
| perf-02-artifact-collection | many-small-files | collectedFiles | 1000 | 1000 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | many-small-files | process.maxRssBytes | 58540032 | 66650112 | 1.138 | 1.137 to 1.140 | worse |
| perf-02-artifact-collection | many-small-files | childWallMs | 217 | 204 | 1.046 | 0.945 to 1.253 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ec2-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-owned-client | firstCallMs | 2.315 | 2.282 | 0.961 | 0.937 to 0.990 | better |
| perf-03-aws-client-reuse | ec2-owned-client | warmCallMedianMs | 0.043 | 0.006 | 0.140 | 0.124 to 0.143 | better |
| perf-03-aws-client-reuse | ec2-owned-client | process.maxRssBytes | 133447680 | 133480448 | 1.003 | 0.995 to 1.016 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | childWallMs | 174 | 202 | 1.161 | 1.060 to 1.202 | worse |
| perf-03-aws-client-reuse | ec2-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-injected-client | process.maxRssBytes | 132530176 | 134725632 | 1.010 | 0.998 to 1.023 | no difference |
| perf-03-aws-client-reuse | ec2-injected-client | childWallMs | 160 | 156 | 1.011 | 0.966 to 1.072 | no difference |
| perf-03-aws-client-reuse | ecs-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ecs-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-owned-client | firstCallMs | 2.407 | 2.275 | 0.940 | 0.891 to 1.020 | no difference |
| perf-03-aws-client-reuse | ecs-owned-client | warmCallMedianMs | 0.056 | 0.007 | 0.127 | 0.118 to 0.134 | better |
| perf-03-aws-client-reuse | ecs-owned-client | process.maxRssBytes | 80019456 | 76890112 | 0.962 | 0.956 to 0.966 | better |
| perf-03-aws-client-reuse | ecs-owned-client | childWallMs | 89.801 | 91.533 | 0.975 | 0.955 to 1.044 | no difference |
| perf-03-aws-client-reuse | ecs-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-injected-client | process.maxRssBytes | 76283904 | 76611584 | 1.003 | 1.001 to 1.008 | worse |
| perf-03-aws-client-reuse | ecs-injected-client | childWallMs | 82.745 | 91.351 | 0.983 | 0.976 to 1.035 | no difference |
| perf-03-aws-client-reuse | lambda-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | lambda-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-owned-client | firstCallMs | 3.385 | 3.157 | 0.959 | 0.911 to 0.980 | better |
| perf-03-aws-client-reuse | lambda-owned-client | warmCallMedianMs | 0.064 | 0.011 | 0.169 | 0.125 to 0.183 | better |
| perf-03-aws-client-reuse | lambda-owned-client | process.maxRssBytes | 82477056 | 78315520 | 0.953 | 0.947 to 0.957 | better |
| perf-03-aws-client-reuse | lambda-owned-client | childWallMs | 106 | 102 | 1.021 | 0.927 to 1.140 | no difference |
| perf-03-aws-client-reuse | lambda-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-injected-client | process.maxRssBytes | 77938688 | 77873152 | 0.998 | 0.996 to 1.000 | no difference |
| perf-03-aws-client-reuse | lambda-injected-client | childWallMs | 88.714 | 90.778 | 1.003 | 0.985 to 1.110 | no difference |
| perf-04-vercel-log-streams | finite-array | entriesReturned | 2000 | 100 | 0.050 | 0.050 to 0.050 | better |
| perf-04-vercel-log-streams | finite-array | settleMs | 22.175 | 22.753 | 1.033 | 1.011 to 1.079 | worse |
| perf-04-vercel-log-streams | finite-array | process.maxRssBytes | 65683456 | 65748992 | 1.001 | 0.999 to 1.004 | no difference |
| perf-04-vercel-log-streams | finite-array | childWallMs | 77.618 | 73.639 | 0.942 | 0.920 to 1.026 | no difference |
| perf-04-vercel-log-streams | ndjson-fragmented | entriesReturned | 2000 | 100 | 0.050 | 0.050 to 0.050 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | settleMs | 40.074 | 21.391 | 0.573 | 0.562 to 0.606 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | process.maxRssBytes | 86458368 | 70320128 | 0.815 | 0.812 to 0.816 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | childWallMs | 88.265 | 69.863 | 0.847 | 0.828 to 0.866 | better |
| perf-04-vercel-log-streams | ndjson-malformed | process.maxRssBytes | 85442560 | 70320128 | 0.822 | 0.819 to 0.824 | better |
| perf-04-vercel-log-streams | ndjson-malformed | childWallMs | 81.838 | 73.734 | 0.895 | 0.849 to 0.924 | better |
| perf-04-vercel-log-streams | endless-limit-10 | settleMs | 3001 | 17.774 | 0.006 | 0.006 to 0.007 | better |
| perf-04-vercel-log-streams | endless-limit-10 | bytesEmitted | 67109012 | 3060 | 0.000 | 0.000 to 0.000 | better |
| perf-04-vercel-log-streams | endless-limit-10 | peakRssGrowthBytes | 215236608 | 9961472 | 0.046 | 0.045 to 0.047 | better |
| perf-04-vercel-log-streams | endless-limit-10 | process.maxRssBytes | 265109504 | 59588608 | 0.225 | 0.224 to 0.226 | better |
| perf-04-vercel-log-streams | endless-limit-10 | childWallMs | 3054 | 71.838 | 0.024 | 0.023 to 0.024 | better |
| perf-04-vercel-log-streams | idle-limit-10 | settleMs | 3001 | 3001 | 1.000 | 1.000 to 1.000 | no difference |
| perf-04-vercel-log-streams | idle-limit-10 | process.maxRssBytes | 60276736 | 60014592 | 0.995 | 0.991 to 0.998 | better |
| perf-04-vercel-log-streams | idle-limit-10 | childWallMs | 3045 | 3047 | 1.001 | 1.000 to 1.004 | no difference |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | elapsedMs | 684 | 201 | 0.295 | 0.291 to 0.298 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | leakedSecrets | 119 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | process.maxRssBytes | 144064512 | 158793728 | 1.102 | 1.097 to 1.108 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | childWallMs | 1028 | 552 | 0.556 | 0.519 to 0.566 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | elapsedMs | 683 | 171 | 0.249 | 0.248 to 0.256 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | leakedSecrets | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | process.maxRssBytes | 142196736 | 145637376 | 1.024 | 1.020 to 1.026 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | childWallMs | 899 | 379 | 0.421 | 0.419 to 0.425 | better |
| perf-09-cli-cold-start | help | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | help | wallMs.p50 | 466 | 35.494 | 0.074 | 0.073 to 0.082 | better |
| perf-09-cli-cold-start | help | maxRssBytes.p50 | 218234880 | 53837824 | 0.247 | 0.246 to 0.247 | better |
| perf-09-cli-cold-start | help | process.maxRssBytes | 48218112 | 48250880 | 1.002 | 0.998 to 1.005 | no difference |
| perf-09-cli-cold-start | help | childWallMs | 5002 | 404 | 0.080 | 0.074 to 0.086 | better |
| perf-09-cli-cold-start | capabilities-json | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | capabilities-json | wallMs.p50 | 471 | 33.886 | 0.075 | 0.069 to 0.079 | better |
| perf-09-cli-cold-start | capabilities-json | maxRssBytes.p50 | 218939392 | 53837824 | 0.246 | 0.245 to 0.247 | better |
| perf-09-cli-cold-start | capabilities-json | process.maxRssBytes | 48201728 | 48185344 | 1.000 | 0.998 to 1.002 | no difference |
| perf-09-cli-cold-start | capabilities-json | childWallMs | 4764 | 389 | 0.081 | 0.075 to 0.087 | better |
| perf-09-cli-cold-start | preset-list-json | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | preset-list-json | wallMs.p50 | 466 | 34.174 | 0.073 | 0.070 to 0.075 | better |
| perf-09-cli-cold-start | preset-list-json | maxRssBytes.p50 | 218497024 | 53821440 | 0.246 | 0.246 to 0.247 | better |
| perf-09-cli-cold-start | preset-list-json | process.maxRssBytes | 48201728 | 48218112 | 1.000 | 0.995 to 1.003 | no difference |
| perf-09-cli-cold-start | preset-list-json | childWallMs | 4983 | 390 | 0.082 | 0.077 to 0.084 | better |
| perf-09-cli-cold-start | completion-bash | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | completion-bash | wallMs.p50 | 502 | 35.451 | 0.073 | 0.072 to 0.075 | better |
| perf-09-cli-cold-start | completion-bash | maxRssBytes.p50 | 219480064 | 53837824 | 0.246 | 0.245 to 0.247 | better |
| perf-09-cli-cold-start | completion-bash | process.maxRssBytes | 48152576 | 48250880 | 1.001 | 1.000 to 1.004 | no difference |
| perf-09-cli-cold-start | completion-bash | childWallMs | 5310 | 410 | 0.080 | 0.074 to 0.082 | better |
| perf-10-docker-output | stdout-10MiB | stdoutLengthReturned | 10485760 | 10485760 | 1.000 | 1.000 to 1.000 | equal |
| perf-10-docker-output | stdout-10MiB | peakRssGrowthBytes | 43843584 | 43548672 | 0.993 | 0.980 to 1.005 | no difference |
| perf-10-docker-output | stdout-10MiB | elapsedMs | 60.746 | 62.552 | 1.079 | 1.041 to 1.099 | worse |
| perf-10-docker-output | stdout-10MiB | process.maxRssBytes | 95453184 | 95420416 | 1.002 | 0.997 to 1.004 | no difference |
| perf-10-docker-output | stdout-10MiB | childWallMs | 124 | 128 | 1.046 | 1.023 to 1.082 | worse |
| perf-10-docker-output | stdout-100MiB | stdoutLengthReturned | 104857600 | 16777216 | 0.160 | 0.160 to 0.160 | better |
| perf-10-docker-output | stdout-100MiB | peakRssGrowthBytes | 405700608 | 111181824 | 0.279 | 0.272 to 0.282 | better |
| perf-10-docker-output | stdout-100MiB | elapsedMs | 567 | 120 | 0.210 | 0.201 to 0.224 | better |
| perf-10-docker-output | stdout-100MiB | process.maxRssBytes | 471564288 | 179191808 | 0.383 | 0.377 to 0.393 | better |
| perf-10-docker-output | stdout-100MiB | childWallMs | 671 | 200 | 0.291 | 0.282 to 0.323 | better |
| perf-11-jsonl-read | read-50k | receiptsRead | 50000 | 50000 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | fileBytes | 21883890 | 21883890 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | peakRssGrowthBytes | 88195072 | 87195648 | 0.989 | 0.986 to 0.992 | better |
| perf-11-jsonl-read | read-50k | elapsedMs | 62.71 | 61.167 | 0.981 | 0.959 to 0.995 | better |
| perf-11-jsonl-read | read-50k | process.maxRssBytes | 172359680 | 172408832 | 1.000 | 0.998 to 1.001 | no difference |
| perf-11-jsonl-read | read-50k | childWallMs | 246 | 234 | 0.948 | 0.886 to 1.079 | no difference |
| perf-11-jsonl-read | corrupt-line-25000 | peakRssGrowthBytes | 72892416 | 72269824 | 0.992 | 0.987 to 0.994 | better |
| perf-11-jsonl-read | corrupt-line-25000 | process.maxRssBytes | 151896064 | 152125440 | 1.001 | 0.999 to 1.001 | no difference |
| perf-11-jsonl-read | corrupt-line-25000 | childWallMs | 212 | 217 | 1.010 | 0.887 to 1.063 | no difference |
