# Interleaved A/B: m4-perf-4831f81

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 20.

A (anchor) 7d3a28a8c0e9b9282b1079ea3d2fc61c32c6f8f7 packages tree 66b109a5e72fdc418d86eb0b060443863ebcf346; B (candidate) 4831f8130f9cc7dddc6e8a2e37223aad36a2afa8 packages tree 97fbe32be7f65a59b01329bc5d49ff98b29b4a59.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 5.9/8.3/9.8, at end 7.6/9.2/9.2.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| m3-bridge-worker | spawn-to-hello-ack | ok runs | 0/20 | 20/20 | | | worker exited before answering; stderr: node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Can |
| m3-bridge-worker | request-round-trip | ok runs | 0/20 | 20/20 | | | worker exited before answering; stderr: node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Can |
| perf-01-core-receipts | long-lived-best-effort | final.receiptsStillReachable | 20000 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | long-lived-best-effort | final.heapBytesPerOperation | 1854 | 62.289 | 0.034 | 0.033 to 0.034 | better |
| perf-01-core-receipts | long-lived-best-effort | opsPerSecond | 112289 | 189122 | 1.656 | 1.614 to 1.745 | better |
| perf-01-core-receipts | long-lived-best-effort | process.maxRssBytes | 131940352 | 119390208 | 0.905 | 0.902 to 0.909 | better |
| perf-01-core-receipts | long-lived-best-effort | childWallMs | 219 | 147 | 0.675 | 0.651 to 0.693 | better |
| perf-01-core-receipts | long-lived-required | final.receiptsStillReachable | 20000 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | long-lived-required | final.heapBytesPerOperation | 2175 | 61.749 | 0.028 | 0.028 to 0.028 | better |
| perf-01-core-receipts | long-lived-required | opsPerSecond | 114329 | 164065 | 1.465 | 1.357 to 1.655 | better |
| perf-01-core-receipts | long-lived-required | process.maxRssBytes | 139239424 | 121069568 | 0.869 | 0.868 to 0.870 | better |
| perf-01-core-receipts | long-lived-required | childWallMs | 216 | 165 | 0.741 | 0.664 to 0.793 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p50 | 52.065 | 3.656 | 0.070 | 0.069 to 0.070 | better |
| perf-01-core-receipts | parallel-required-delayed-a | bLatencyMs.p95 | 53.059 | 3.934 | 0.074 | 0.074 to 0.075 | better |
| perf-01-core-receipts | parallel-required-delayed-a | process.maxRssBytes | 54984704 | 54910976 | 0.998 | 0.996 to 0.999 | better |
| perf-01-core-receipts | parallel-required-delayed-a | childWallMs | 2131 | 2139 | 1.005 | 1.002 to 1.009 | worse |
| perf-01-core-receipts | parallel-required-failing-a | outcomes.bRejectedWithAError | 40 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-01-core-receipts | parallel-required-failing-a | outcomes.aRejected | 40 | 40 | 1.000 | 1.000 to 1.000 | equal |
| perf-01-core-receipts | parallel-required-failing-a | bLatencyMs.p50 | 6.892 | 3.552 | 0.522 | 0.512 to 0.532 | better |
| perf-01-core-receipts | parallel-required-failing-a | process.maxRssBytes | 55099392 | 54992896 | 0.998 | 0.997 to 1.000 | no difference |
| perf-01-core-receipts | parallel-required-failing-a | childWallMs | 315 | 308 | 0.986 | 0.971 to 1.004 | no difference |
| perf-01-core-receipts | required-inflight-bookkeeping | heapBytesPerOperation | 2119 | 7.012 | 0.003 | 0.003 to 0.003 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | failures | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-01-core-receipts | required-inflight-bookkeeping | process.maxRssBytes | 203350016 | 69025792 | 0.339 | 0.338 to 0.341 | better |
| perf-01-core-receipts | required-inflight-bookkeeping | childWallMs | 433 | 211 | 0.497 | 0.481 to 0.534 | better |
| perf-02-artifact-collection | large-file-tiny-limit | bytesRead | 16777216 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-02-artifact-collection | large-file-tiny-limit | peakRssGrowthBytes | 16891904 | 49152 | 0.003 | 0.003 to 0.003 | better |
| perf-02-artifact-collection | large-file-tiny-limit | process.maxRssBytes | 65323008 | 48398336 | 0.741 | 0.740 to 0.741 | better |
| perf-02-artifact-collection | large-file-tiny-limit | childWallMs | 42.31 | 38.411 | 0.903 | 0.880 to 0.918 | better |
| perf-02-artifact-collection | large-file-within-budget | bytesRead | 50331648 | 50331648 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-within-budget | peakRssGrowthBytes | 50429952 | 65536 | 0.001 | 0.001 to 0.002 | better |
| perf-02-artifact-collection | large-file-within-budget | elapsedMs | 26.439 | 19.572 | 0.751 | 0.715 to 0.833 | better |
| perf-02-artifact-collection | large-file-within-budget | process.maxRssBytes | 100057088 | 49684480 | 0.497 | 0.496 to 0.497 | better |
| perf-02-artifact-collection | large-file-within-budget | childWallMs | 93.485 | 86.407 | 0.894 | 0.870 to 0.921 | better |
| perf-02-artifact-collection | many-small-files | elapsedMs | 18.31 | 20.317 | 1.096 | 0.970 to 1.195 | no difference |
| perf-02-artifact-collection | many-small-files | collectedFiles | 1000 | 1000 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | many-small-files | process.maxRssBytes | 58474496 | 58376192 | 0.997 | 0.996 to 0.999 | better |
| perf-02-artifact-collection | many-small-files | childWallMs | 159 | 161 | 1.010 | 0.994 to 1.045 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ec2-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-owned-client | firstCallMs | 2.273 | 2.318 | 1.013 | 0.950 to 1.078 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | warmCallMedianMs | 0.042 | 0.006 | 0.137 | 0.126 to 0.144 | better |
| perf-03-aws-client-reuse | ec2-owned-client | process.maxRssBytes | 132513792 | 132407296 | 0.998 | 0.995 to 1.011 | no difference |
| perf-03-aws-client-reuse | ec2-owned-client | childWallMs | 196 | 181 | 0.922 | 0.905 to 0.967 | better |
| perf-03-aws-client-reuse | ec2-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ec2-injected-client | process.maxRssBytes | 132472832 | 132587520 | 1.002 | 0.997 to 1.006 | no difference |
| perf-03-aws-client-reuse | ec2-injected-client | childWallMs | 159 | 160 | 1.024 | 0.945 to 1.044 | no difference |
| perf-03-aws-client-reuse | ecs-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | ecs-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-owned-client | firstCallMs | 2.11 | 2.261 | 1.057 | 1.009 to 1.131 | worse |
| perf-03-aws-client-reuse | ecs-owned-client | warmCallMedianMs | 0.053 | 0.007 | 0.131 | 0.126 to 0.136 | better |
| perf-03-aws-client-reuse | ecs-owned-client | process.maxRssBytes | 80142336 | 77242368 | 0.961 | 0.958 to 0.966 | better |
| perf-03-aws-client-reuse | ecs-owned-client | childWallMs | 90.746 | 89.605 | 0.976 | 0.945 to 1.001 | no difference |
| perf-03-aws-client-reuse | ecs-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | ecs-injected-client | process.maxRssBytes | 76464128 | 76488704 | 0.998 | 0.996 to 1.003 | no difference |
| perf-03-aws-client-reuse | ecs-injected-client | childWallMs | 81.698 | 82.552 | 1.011 | 0.976 to 1.033 | no difference |
| perf-03-aws-client-reuse | lambda-owned-client | uniqueSdkClients | 50 | 1 | 0.020 | 0.020 to 0.020 | better |
| perf-03-aws-client-reuse | lambda-owned-client | sendCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-owned-client | firstCallMs | 3.138 | 3.243 | 1.008 | 0.985 to 1.078 | no difference |
| perf-03-aws-client-reuse | lambda-owned-client | warmCallMedianMs | 0.063 | 0.011 | 0.172 | 0.153 to 0.181 | better |
| perf-03-aws-client-reuse | lambda-owned-client | process.maxRssBytes | 82591744 | 78602240 | 0.952 | 0.950 to 0.955 | better |
| perf-03-aws-client-reuse | lambda-owned-client | childWallMs | 103 | 95.699 | 0.912 | 0.902 to 0.951 | better |
| perf-03-aws-client-reuse | lambda-injected-client | uniqueSdkClients | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-injected-client | injectedClientCalls | 50 | 50 | 1.000 | 1.000 to 1.000 | equal |
| perf-03-aws-client-reuse | lambda-injected-client | process.maxRssBytes | 78053376 | 77758464 | 0.997 | 0.995 to 0.998 | better |
| perf-03-aws-client-reuse | lambda-injected-client | childWallMs | 88.212 | 89.02 | 1.016 | 0.978 to 1.036 | no difference |
| perf-04-vercel-log-streams | finite-array | entriesReturned | 2000 | 100 | 0.050 | 0.050 to 0.050 | changed |
| perf-04-vercel-log-streams | finite-array | settleMs | 20.681 | 19.861 | 0.972 | 0.931 to 0.995 | better |
| perf-04-vercel-log-streams | finite-array | process.maxRssBytes | 65503232 | 64733184 | 0.988 | 0.986 to 0.990 | better |
| perf-04-vercel-log-streams | finite-array | childWallMs | 70.131 | 69.625 | 0.991 | 0.976 to 1.012 | no difference |
| perf-04-vercel-log-streams | ndjson-fragmented | entriesReturned | 2000 | 100 | 0.050 | 0.050 to 0.050 | changed |
| perf-04-vercel-log-streams | ndjson-fragmented | settleMs | 38.259 | 20.183 | 0.520 | 0.511 to 0.535 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | process.maxRssBytes | 86196224 | 69640192 | 0.808 | 0.804 to 0.809 | better |
| perf-04-vercel-log-streams | ndjson-fragmented | childWallMs | 81.228 | 68.713 | 0.838 | 0.829 to 0.847 | better |
| perf-04-vercel-log-streams | ndjson-malformed | process.maxRssBytes | 85499904 | 69623808 | 0.815 | 0.811 to 0.817 | better |
| perf-04-vercel-log-streams | ndjson-malformed | childWallMs | 82.133 | 69.842 | 0.871 | 0.859 to 0.897 | better |
| perf-04-vercel-log-streams | endless-limit-10 | settleMs | 3001 | 19.361 | 0.006 | 0.006 to 0.007 | better |
| perf-04-vercel-log-streams | endless-limit-10 | bytesEmitted | 67109012 | 3060 | 0.000 | 0.000 to 0.000 | better |
| perf-04-vercel-log-streams | endless-limit-10 | peakRssGrowthBytes | 215220224 | 9412608 | 0.044 | 0.043 to 0.044 | better |
| perf-04-vercel-log-streams | endless-limit-10 | process.maxRssBytes | 265052160 | 59056128 | 0.223 | 0.222 to 0.223 | better |
| perf-04-vercel-log-streams | endless-limit-10 | childWallMs | 3058 | 82.715 | 0.027 | 0.026 to 0.028 | better |
| perf-04-vercel-log-streams | idle-limit-10 | settleMs | 3001 | 3002 | 1.000 | 1.000 to 1.000 | no difference |
| perf-04-vercel-log-streams | idle-limit-10 | process.maxRssBytes | 60235776 | 60030976 | 0.996 | 0.995 to 0.998 | better |
| perf-04-vercel-log-streams | idle-limit-10 | childWallMs | 3047 | 3056 | 1.003 | 1.002 to 1.004 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | changed |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | elapsedMs | 685 | 180 | 0.262 | 0.259 to 0.264 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | leakedSecrets | 119 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | process.maxRssBytes | 143491072 | 145866752 | 1.018 | 1.014 to 1.021 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-all | childWallMs | 1055 | 506 | 0.484 | 0.465 to 0.499 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | maxOutstandingRequests | 1 | 4 | 4.000 | 4.000 to 4.000 | changed |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | elapsedMs | 686 | 173 | 0.252 | 0.250 to 0.253 | better |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | leakedSecrets | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | process.maxRssBytes | 141991936 | 143400960 | 1.010 | 1.008 to 1.011 | worse |
| perf-05-kubernetes-logs | 40-pods-3-containers-limit-20 | childWallMs | 901 | 389 | 0.430 | 0.422 to 0.438 | better |
| perf-09-cli-cold-start | help | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | help | wallMs.p50 | 478 | 35.699 | 0.074 | 0.073 to 0.079 | better |
| perf-09-cli-cold-start | help | maxRssBytes.p50 | 217972736 | 54198272 | 0.249 | 0.248 to 0.249 | better |
| perf-09-cli-cold-start | help | process.maxRssBytes | 47857664 | 48324608 | 1.010 | 1.006 to 1.012 | worse |
| perf-09-cli-cold-start | help | childWallMs | 5221 | 399 | 0.079 | 0.075 to 0.082 | better |
| perf-09-cli-cold-start | capabilities-json | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | capabilities-json | wallMs.p50 | 468 | 36.249 | 0.077 | 0.074 to 0.081 | better |
| perf-09-cli-cold-start | capabilities-json | maxRssBytes.p50 | 218202112 | 54460416 | 0.250 | 0.249 to 0.250 | better |
| perf-09-cli-cold-start | capabilities-json | process.maxRssBytes | 48103424 | 48455680 | 1.008 | 1.002 to 1.011 | worse |
| perf-09-cli-cold-start | capabilities-json | childWallMs | 4878 | 404 | 0.082 | 0.077 to 0.087 | better |
| perf-09-cli-cold-start | preset-list-json | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | preset-list-json | wallMs.p50 | 461 | 36.582 | 0.076 | 0.074 to 0.078 | better |
| perf-09-cli-cold-start | preset-list-json | maxRssBytes.p50 | 217923584 | 54222848 | 0.249 | 0.248 to 0.249 | better |
| perf-09-cli-cold-start | preset-list-json | process.maxRssBytes | 47947776 | 48291840 | 1.005 | 1.004 to 1.010 | worse |
| perf-09-cli-cold-start | preset-list-json | childWallMs | 5038 | 405 | 0.081 | 0.080 to 0.084 | better |
| perf-09-cli-cold-start | completion-bash | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-09-cli-cold-start | completion-bash | wallMs.p50 | 464 | 35.668 | 0.077 | 0.075 to 0.078 | better |
| perf-09-cli-cold-start | completion-bash | maxRssBytes.p50 | 217997312 | 54190080 | 0.249 | 0.248 to 0.249 | better |
| perf-09-cli-cold-start | completion-bash | process.maxRssBytes | 48046080 | 48177152 | 1.003 | 0.999 to 1.005 | no difference |
| perf-09-cli-cold-start | completion-bash | childWallMs | 4822 | 400 | 0.081 | 0.076 to 0.086 | better |
| perf-10-docker-output | stdout-10MiB | stdoutLengthReturned | 10485760 | 10485760 | 1.000 | 1.000 to 1.000 | equal |
| perf-10-docker-output | stdout-10MiB | peakRssGrowthBytes | 44318720 | 44113920 | 0.995 | 0.987 to 0.999 | better |
| perf-10-docker-output | stdout-10MiB | elapsedMs | 58.858 | 59.821 | 0.994 | 0.961 to 1.021 | no difference |
| perf-10-docker-output | stdout-10MiB | process.maxRssBytes | 95895552 | 95887360 | 0.999 | 0.995 to 1.003 | no difference |
| perf-10-docker-output | stdout-10MiB | childWallMs | 125 | 126 | 0.993 | 0.944 to 1.018 | no difference |
| perf-10-docker-output | stdout-100MiB | stdoutLengthReturned | 104857600 | 16777216 | 0.160 | 0.160 to 0.160 | changed |
| perf-10-docker-output | stdout-100MiB | peakRssGrowthBytes | 404963328 | 112402432 | 0.278 | 0.275 to 0.280 | better |
| perf-10-docker-output | stdout-100MiB | elapsedMs | 555 | 101 | 0.182 | 0.174 to 0.188 | better |
| perf-10-docker-output | stdout-100MiB | process.maxRssBytes | 471769088 | 177717248 | 0.378 | 0.377 to 0.384 | better |
| perf-10-docker-output | stdout-100MiB | childWallMs | 665 | 169 | 0.256 | 0.247 to 0.264 | better |
| perf-11-jsonl-read | read-50k | receiptsRead | 50000 | 50000 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | fileBytes | 21883890 | 21883890 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | read-50k | peakRssGrowthBytes | 88170496 | 59293696 | 0.672 | 0.672 to 0.673 | better |
| perf-11-jsonl-read | read-50k | elapsedMs | 60.087 | 61.546 | 1.040 | 1.004 to 1.117 | worse |
| perf-11-jsonl-read | read-50k | heapUsedWhileHeldBytes | 80603344 | 43723192 | 0.542 | 0.542 to 0.543 | better |
| perf-11-jsonl-read | read-50k | process.maxRssBytes | 172335104 | 144285696 | 0.838 | 0.837 to 0.838 | better |
| perf-11-jsonl-read | read-50k | childWallMs | 208 | 212 | 0.982 | 0.959 to 1.115 | no difference |
| perf-11-jsonl-read | iterate-50k | ok runs | 0/20 | 20/20 | | | not available in this build: JsonlReceiptStore.iterate |
| perf-11-jsonl-read | cli-verify-50k | exitCode | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-11-jsonl-read | cli-verify-50k | cliMaxRssBytes | 400695296 | 228728832 | 0.572 | 0.570 to 0.598 | better |
| perf-11-jsonl-read | cli-verify-50k | wallMs | 776 | 382 | 0.491 | 0.461 to 0.513 | better |
| perf-11-jsonl-read | cli-verify-50k | process.maxRssBytes | 169181184 | 190660608 | 1.127 | 1.084 to 1.128 | worse |
| perf-11-jsonl-read | cli-verify-50k | childWallMs | 964 | 581 | 0.590 | 0.560 to 0.620 | better |
| perf-11-jsonl-read | corrupt-line-25000 | peakRssGrowthBytes | 73162752 | 35774464 | 0.489 | 0.488 to 0.490 | better |
| perf-11-jsonl-read | corrupt-line-25000 | process.maxRssBytes | 151969792 | 115548160 | 0.760 | 0.759 to 0.762 | better |
| perf-11-jsonl-read | corrupt-line-25000 | childWallMs | 186 | 174 | 0.959 | 0.925 to 0.993 | better |
| perf-12-sqlite-store | file-2000-writes | writeMs | 746 | 768 | 0.955 | 0.899 to 1.060 | no difference |
| perf-12-sqlite-store | file-2000-writes | writePrepareCalls | 2001 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-12-sqlite-store | file-2000-writes | writePrepareMs | 11.433 | 0.03 | 0.003 | 0.002 to 0.003 | better |
| perf-12-sqlite-store | file-2000-writes | writeExecuteMs | 732 | 768 | 0.970 | 0.914 to 1.080 | no difference |
| perf-12-sqlite-store | file-2000-writes | readMs | 17.406 | 15.466 | 0.870 | 0.830 to 0.945 | better |
| perf-12-sqlite-store | file-2000-writes | process.maxRssBytes | 86663168 | 75579392 | 0.872 | 0.871 to 0.873 | better |
| perf-12-sqlite-store | file-2000-writes | childWallMs | 820 | 845 | 0.957 | 0.901 to 1.063 | no difference |
| perf-12-sqlite-store | memory-2000-writes | writeMs | 16.164 | 7.964 | 0.488 | 0.479 to 0.501 | better |
| perf-12-sqlite-store | memory-2000-writes | writePrepareCalls | 2001 | 1 | 0.000 | 0.000 to 0.000 | better |
| perf-12-sqlite-store | memory-2000-writes | writePrepareMs | 6.349 | 0.032 | 0.005 | 0.004 to 0.006 | better |
| perf-12-sqlite-store | memory-2000-writes | writeExecuteMs | 9.846 | 7.925 | 0.797 | 0.782 to 0.821 | better |
| perf-12-sqlite-store | memory-2000-writes | readMs | 17.405 | 15.853 | 0.905 | 0.871 to 0.931 | better |
| perf-12-sqlite-store | memory-2000-writes | process.maxRssBytes | 86646784 | 75685888 | 0.874 | 0.873 to 0.874 | better |
| perf-12-sqlite-store | memory-2000-writes | childWallMs | 88.08 | 78.668 | 0.866 | 0.851 to 0.904 | better |
| perf-14-docker-artifacts | paths-1 | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | elapsedMs | 17.59 | 17.092 | 0.970 | 0.907 to 1.036 | no difference |
| perf-14-docker-artifacts | paths-1 | process.maxRssBytes | 52248576 | 52445184 | 1.004 | 1.003 to 1.005 | worse |
| perf-14-docker-artifacts | paths-1 | childWallMs | 83.429 | 84.645 | 1.000 | 0.980 to 1.028 | no difference |
| perf-14-docker-artifacts | paths-10 | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | paths-10 | elapsedMs | 77.814 | 35.065 | 0.462 | 0.407 to 0.503 | better |
| perf-14-docker-artifacts | paths-10 | process.maxRssBytes | 57327616 | 57671680 | 1.007 | 1.005 to 1.009 | worse |
| perf-14-docker-artifacts | paths-10 | childWallMs | 146 | 102 | 0.699 | 0.617 to 0.755 | better |
| perf-14-docker-artifacts | paths-100 | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100 | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | paths-100 | elapsedMs | 678 | 235 | 0.307 | 0.296 to 0.374 | better |
| perf-14-docker-artifacts | paths-100 | process.maxRssBytes | 59236352 | 60022784 | 1.013 | 1.012 to 1.016 | worse |
| perf-14-docker-artifacts | paths-100 | childWallMs | 782 | 326 | 0.393 | 0.361 to 0.462 | better |
| perf-14-docker-artifacts | paths-1-latency-25ms | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | elapsedMs | 46.575 | 47.47 | 1.008 | 0.956 to 1.060 | no difference |
| perf-14-docker-artifacts | paths-1-latency-25ms | process.maxRssBytes | 52248576 | 52371456 | 1.002 | 1.001 to 1.004 | worse |
| perf-14-docker-artifacts | paths-1-latency-25ms | childWallMs | 109 | 108 | 1.006 | 0.972 to 1.016 | no difference |
| perf-14-docker-artifacts | paths-10-latency-25ms | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10-latency-25ms | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | paths-10-latency-25ms | elapsedMs | 397 | 130 | 0.327 | 0.320 to 0.333 | better |
| perf-14-docker-artifacts | paths-10-latency-25ms | process.maxRssBytes | 57344000 | 57704448 | 1.006 | 1.004 to 1.009 | worse |
| perf-14-docker-artifacts | paths-10-latency-25ms | childWallMs | 466 | 201 | 0.428 | 0.421 to 0.441 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100-latency-25ms | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | paths-100-latency-25ms | elapsedMs | 3937 | 972 | 0.249 | 0.245 to 0.251 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | process.maxRssBytes | 58400768 | 60096512 | 1.032 | 1.015 to 1.034 | worse |
| perf-14-docker-artifacts | paths-100-latency-25ms | childWallMs | 4030 | 1060 | 0.263 | 0.261 to 0.270 | better |
| perf-14-docker-artifacts | nested-10 | dockerCpSpawns | 11 | 11 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-10 | bytesCollected | 45056 | 40960 | 0.909 | 0.909 to 0.909 | changed |
| perf-14-docker-artifacts | nested-10 | elapsedMs | 78.28 | 78.243 | 1.036 | 0.915 to 1.097 | no difference |
| perf-14-docker-artifacts | nested-10 | process.maxRssBytes | 57655296 | 57737216 | 1.002 | 1.001 to 1.004 | worse |
| perf-14-docker-artifacts | nested-10 | childWallMs | 142 | 143 | 1.021 | 0.949 to 1.062 | no difference |
| perf-14-docker-artifacts | nested-100 | dockerCpSpawns | 101 | 101 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-100 | bytesCollected | 413696 | 409600 | 0.990 | 0.990 to 0.990 | changed |
| perf-14-docker-artifacts | nested-100 | elapsedMs | 676 | 657 | 0.982 | 0.874 to 1.040 | no difference |
| perf-14-docker-artifacts | nested-100 | process.maxRssBytes | 59981824 | 60375040 | 1.007 | 1.006 to 1.007 | worse |
| perf-14-docker-artifacts | nested-100 | childWallMs | 758 | 741 | 0.991 | 0.888 to 1.038 | no difference |
| perf-14-docker-artifacts | real-docker-paths-10 | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | real-docker-paths-10 | elapsedMs | 281 | 140 | 0.501 | 0.430 to 0.581 | better |
| perf-14-docker-artifacts | real-docker-paths-10 | process.maxRssBytes | 52510720 | 57491456 | 1.095 | 1.094 to 1.097 | worse |
| perf-14-docker-artifacts | real-docker-paths-10 | childWallMs | 992 | 543 | 0.547 | 0.521 to 0.599 | better |
| perf-14-docker-artifacts | real-docker-paths-100 | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | real-docker-paths-100 | elapsedMs | 2289 | 713 | 0.328 | 0.258 to 0.343 | better |
| perf-14-docker-artifacts | real-docker-paths-100 | process.maxRssBytes | 58105856 | 59768832 | 1.016 | 1.014 to 1.038 | worse |
| perf-14-docker-artifacts | real-docker-paths-100 | childWallMs | 2758 | 1198 | 0.450 | 0.397 to 0.456 | better |
