# Interleaved A/B: review-fixes-1b43859-vs-aeefbb2

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 20.

A (anchor) aeefbb256c8314240e63e339b5bf0dae126fd093 packages tree cf7875190d8205697a7a93db8194dc50e04485b3; B (candidate) 1b43859d81d052de0784d9a795814af9557c576a packages tree fe78af81afaafa586b653ca94efafe57a6a1b006.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 11.7/13.3/15.1, at end 9.6/14.6/15.7.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-02-artifact-collection | large-file-tiny-limit | bytesRead | 0 | 0 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-tiny-limit | peakRssGrowthBytes | 49152 | 49152 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-tiny-limit | process.maxRssBytes | 48439296 | 48472064 | 1.000 | 0.999 to 1.001 | no difference |
| perf-02-artifact-collection | large-file-tiny-limit | childWallMs | 56.732 | 56.393 | 0.951 | 0.848 to 1.038 | no difference |
| perf-02-artifact-collection | large-file-within-budget | bytesRead | 50331648 | 50331648 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | large-file-within-budget | peakRssGrowthBytes | 65536 | 81920 | 1.000 | 1.000 to 1.250 | no difference |
| perf-02-artifact-collection | large-file-within-budget | elapsedMs | 20.786 | 21.031 | 1.006 | 0.938 to 1.072 | no difference |
| perf-02-artifact-collection | large-file-within-budget | process.maxRssBytes | 49750016 | 49807360 | 0.999 | 0.999 to 1.000 | no difference |
| perf-02-artifact-collection | large-file-within-budget | childWallMs | 218 | 204 | 0.890 | 0.716 to 1.049 | no difference |
| perf-02-artifact-collection | many-small-files | elapsedMs | 31.8 | 30.116 | 0.978 | 0.808 to 1.134 | no difference |
| perf-02-artifact-collection | many-small-files | collectedFiles | 1000 | 1000 | 1.000 | 1.000 to 1.000 | equal |
| perf-02-artifact-collection | many-small-files | process.maxRssBytes | 58548224 | 58531840 | 1.000 | 0.998 to 1.001 | no difference |
| perf-02-artifact-collection | many-small-files | childWallMs | 1166 | 1051 | 0.784 | 0.563 to 1.117 | no difference |
| perf-14-docker-artifacts | paths-1 | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | elapsedMs | 35.335 | 37.198 | 1.084 | 1.001 to 1.322 | worse |
| perf-14-docker-artifacts | paths-1 | process.maxRssBytes | 57081856 | 57057280 | 0.999 | 0.998 to 1.002 | no difference |
| perf-14-docker-artifacts | paths-1 | childWallMs | 131 | 128 | 0.956 | 0.892 to 1.100 | no difference |
| perf-14-docker-artifacts | paths-10 | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | bytesCollected | 40960 | 40960 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | elapsedMs | 84.179 | 82.37 | 1.015 | 0.823 to 1.248 | no difference |
| perf-14-docker-artifacts | paths-10 | process.maxRssBytes | 57688064 | 57827328 | 1.003 | 1.000 to 1.003 | worse |
| perf-14-docker-artifacts | paths-10 | childWallMs | 186 | 212 | 1.055 | 0.898 to 1.203 | no difference |
| perf-14-docker-artifacts | paths-100 | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100 | bytesCollected | 409600 | 409600 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100 | elapsedMs | 620 | 578 | 0.977 | 0.801 to 1.125 | no difference |
| perf-14-docker-artifacts | paths-100 | process.maxRssBytes | 60317696 | 60243968 | 0.998 | 0.997 to 1.001 | no difference |
| perf-14-docker-artifacts | paths-100 | childWallMs | 962 | 948 | 0.980 | 0.830 to 1.173 | no difference |
| perf-14-docker-artifacts | paths-1-latency-25ms | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1-latency-25ms | elapsedMs | 64.582 | 62.672 | 0.955 | 0.864 to 1.053 | no difference |
| perf-14-docker-artifacts | paths-1-latency-25ms | process.maxRssBytes | 57073664 | 57040896 | 0.999 | 0.997 to 1.001 | no difference |
| perf-14-docker-artifacts | paths-1-latency-25ms | childWallMs | 167 | 179 | 1.022 | 0.882 to 1.126 | no difference |
| perf-14-docker-artifacts | paths-10-latency-25ms | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10-latency-25ms | bytesCollected | 40960 | 40960 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10-latency-25ms | elapsedMs | 208 | 202 | 0.971 | 0.823 to 1.246 | no difference |
| perf-14-docker-artifacts | paths-10-latency-25ms | process.maxRssBytes | 57778176 | 57761792 | 1.000 | 0.998 to 1.001 | no difference |
| perf-14-docker-artifacts | paths-10-latency-25ms | childWallMs | 326 | 345 | 0.999 | 0.799 to 1.246 | no difference |
| perf-14-docker-artifacts | paths-100-latency-25ms | dockerCpSpawns | 100 | 100 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100-latency-25ms | bytesCollected | 409600 | 409600 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-100-latency-25ms | elapsedMs | 1422 | 1401 | 0.990 | 0.932 to 1.062 | no difference |
| perf-14-docker-artifacts | paths-100-latency-25ms | process.maxRssBytes | 60366848 | 60186624 | 0.997 | 0.995 to 0.998 | better |
| perf-14-docker-artifacts | paths-100-latency-25ms | childWallMs | 1802 | 1663 | 0.960 | 0.869 to 1.064 | no difference |
| perf-14-docker-artifacts | nested-10 | dockerCpSpawns | 11 | 11 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-10 | bytesCollected | 40960 | 40960 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-10 | elapsedMs | 203 | 261 | 1.043 | 0.861 to 1.273 | no difference |
| perf-14-docker-artifacts | nested-10 | process.maxRssBytes | 57753600 | 57843712 | 1.001 | 0.999 to 1.002 | no difference |
| perf-14-docker-artifacts | nested-10 | childWallMs | 374 | 426 | 1.088 | 0.914 to 1.265 | no difference |
| perf-14-docker-artifacts | nested-100 | dockerCpSpawns | 101 | 101 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-100 | bytesCollected | 409600 | 409600 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-100 | elapsedMs | 2069 | 1964 | 1.058 | 0.896 to 1.170 | no difference |
| perf-14-docker-artifacts | nested-100 | process.maxRssBytes | 60448768 | 60497920 | 1.002 | 1.001 to 1.004 | worse |
| perf-14-docker-artifacts | nested-100 | childWallMs | 2430 | 2301 | 0.989 | 0.856 to 1.110 | no difference |
