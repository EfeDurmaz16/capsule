# Interleaved A/B: review-fixes-1b43859

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 20.

A (anchor) 7d3a28a8c0e9b9282b1079ea3d2fc61c32c6f8f7 packages tree 66b109a5e72fdc418d86eb0b060443863ebcf346; B (candidate) 1b43859d81d052de0784d9a795814af9557c576a packages tree fe78af81afaafa586b653ca94efafe57a6a1b006.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 13.5/13.4/16.8, at end 9.9/13.3/15.2.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-02-artifact-collection | large-file-tiny-limit | bytesRead | 16777216 | 0 | 0.000 | 0.000 to 0.000 | better |
| perf-02-artifact-collection | large-file-tiny-limit | peakRssGrowthBytes | 16891904 | 49152 | 0.003 | 0.003 to 0.003 | better |
| perf-02-artifact-collection | large-file-tiny-limit | process.maxRssBytes | 65355776 | 48537600 | 0.743 | 0.742 to 0.745 | better |
| perf-02-artifact-collection | large-file-tiny-limit | childWallMs | 69.445 | 61.383 | 0.903 | 0.824 to 0.994 | better |
| perf-02-artifact-collection | large-file-within-budget | bytesRead | 50331648 | 50331648 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-within-budget | peakRssGrowthBytes | 50429952 | 73728 | 0.001 | 0.001 to 0.002 | better |
| perf-02-artifact-collection | large-file-within-budget | elapsedMs | 28.154 | 21.516 | 0.766 | 0.737 to 0.801 | better |
| perf-02-artifact-collection | large-file-within-budget | process.maxRssBytes | 100171776 | 49823744 | 0.498 | 0.497 to 0.498 | better |
| perf-02-artifact-collection | large-file-within-budget | childWallMs | 279 | 268 | 0.854 | 0.763 to 1.043 | no difference |
| perf-02-artifact-collection | many-small-files | elapsedMs | 33.415 | 31.017 | 0.918 | 0.808 to 1.042 | no difference |
| perf-02-artifact-collection | many-small-files | collectedFiles | 1000 | 1000 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | many-small-files | process.maxRssBytes | 58621952 | 58540032 | 0.997 | 0.996 to 1.003 | no difference |
| perf-02-artifact-collection | many-small-files | childWallMs | 2521 | 2092 | 0.896 | 0.612 to 1.330 | no difference |
| perf-14-docker-artifacts | paths-1 | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | elapsedMs | 40.749 | 39.774 | 1.127 | 0.896 to 1.308 | no difference |
| perf-14-docker-artifacts | paths-1 | process.maxRssBytes | 56868864 | 57024512 | 1.003 | 1.001 to 1.004 | worse |
| perf-14-docker-artifacts | paths-1 | childWallMs | 145 | 162 | 1.065 | 0.987 to 1.228 | no difference |
| perf-14-docker-artifacts | paths-10 | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | paths-10 | elapsedMs | 189 | 111 | 0.560 | 0.447 to 0.724 | better |
| perf-14-docker-artifacts | paths-10 | process.maxRssBytes | 57360384 | 57786368 | 1.008 | 1.006 to 1.010 | worse |
| perf-14-docker-artifacts | paths-10 | childWallMs | 372 | 233 | 0.742 | 0.603 to 0.845 | better |
| perf-14-docker-artifacts | paths-100 | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100 | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | paths-100 | elapsedMs | 1982 | 722 | 0.426 | 0.382 to 0.495 | better |
| perf-14-docker-artifacts | paths-100 | process.maxRssBytes | 59424768 | 60235776 | 1.014 | 1.012 to 1.015 | worse |
| perf-14-docker-artifacts | paths-100 | childWallMs | 2474 | 1237 | 0.601 | 0.465 to 0.671 | better |
| perf-14-docker-artifacts | paths-1-latency-25ms | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | elapsedMs | 81.307 | 69.159 | 0.939 | 0.901 to 1.169 | no difference |
| perf-14-docker-artifacts | paths-1-latency-25ms | process.maxRssBytes | 56967168 | 57081856 | 1.002 | 1.001 to 1.004 | worse |
| perf-14-docker-artifacts | paths-1-latency-25ms | childWallMs | 181 | 177 | 0.977 | 0.909 to 1.093 | no difference |
| perf-14-docker-artifacts | paths-10-latency-25ms | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10-latency-25ms | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | paths-10-latency-25ms | elapsedMs | 537 | 220 | 0.400 | 0.329 to 0.427 | better |
| perf-14-docker-artifacts | paths-10-latency-25ms | process.maxRssBytes | 57401344 | 57663488 | 1.004 | 1.004 to 1.009 | worse |
| perf-14-docker-artifacts | paths-10-latency-25ms | childWallMs | 691 | 387 | 0.522 | 0.488 to 0.588 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100-latency-25ms | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | paths-100-latency-25ms | elapsedMs | 5550 | 1644 | 0.288 | 0.274 to 0.332 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | process.maxRssBytes | 59285504 | 60243968 | 1.016 | 1.014 to 1.025 | worse |
| perf-14-docker-artifacts | paths-100-latency-25ms | childWallMs | 6419 | 2261 | 0.346 | 0.322 to 0.397 | better |
| perf-14-docker-artifacts | nested-10 | dockerCpSpawns | 11 | 11 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-10 | bytesCollected | 45056 | 40960 | 0.909 | 0.909 to 0.909 | changed |
| perf-14-docker-artifacts | nested-10 | elapsedMs | 386 | 392 | 1.132 | 0.795 to 1.287 | no difference |
| perf-14-docker-artifacts | nested-10 | process.maxRssBytes | 57614336 | 57892864 | 1.004 | 1.001 to 1.005 | worse |
| perf-14-docker-artifacts | nested-10 | childWallMs | 579 | 639 | 1.042 | 0.831 to 1.441 | no difference |
| perf-14-docker-artifacts | nested-100 | dockerCpSpawns | 101 | 101 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-100 | bytesCollected | 413696 | 409600 | 0.990 | 0.990 to 0.990 | changed |
| perf-14-docker-artifacts | nested-100 | elapsedMs | 2609 | 3066 | 1.082 | 0.913 to 1.280 | no difference |
| perf-14-docker-artifacts | nested-100 | process.maxRssBytes | 60178432 | 60522496 | 1.006 | 1.005 to 1.007 | worse |
| perf-14-docker-artifacts | nested-100 | childWallMs | 3276 | 3457 | 1.065 | 0.900 to 1.248 | no difference |
