# Interleaved A/B: review-fixes-1b43859-vs-aeefbb2-recheck

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 40.

A (anchor) aeefbb256c8314240e63e339b5bf0dae126fd093 packages tree cf7875190d8205697a7a93db8194dc50e04485b3; B (candidate) 1b43859d81d052de0784d9a795814af9557c576a packages tree fe78af81afaafa586b653ca94efafe57a6a1b006.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 11.4/14.4/15.5, at end 11.6/14.8/15.7.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-14-docker-artifacts | paths-1 | dockerCpSpawns | 1 | 1 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | bytesCollected | 4096 | 4096 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-1 | elapsedMs | 34.899 | 36.664 | 0.968 | 0.776 to 1.153 | no difference |
| perf-14-docker-artifacts | paths-1 | process.maxRssBytes | 57139200 | 57040896 | 0.999 | 0.997 to 1.002 | no difference |
| perf-14-docker-artifacts | paths-1 | childWallMs | 147 | 139 | 0.947 | 0.913 to 1.069 | no difference |
| perf-14-docker-artifacts | paths-10 | dockerCpSpawns | 10 | 10 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | bytesCollected | 40960 | 40960 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | paths-10 | elapsedMs | 98.997 | 103 | 0.944 | 0.826 to 1.025 | no difference |
| perf-14-docker-artifacts | paths-10 | process.maxRssBytes | 57769984 | 57835520 | 1.001 | 0.999 to 1.002 | no difference |
| perf-14-docker-artifacts | paths-10 | childWallMs | 265 | 257 | 0.891 | 0.840 to 0.941 | better |
| perf-14-docker-artifacts | nested-100 | dockerCpSpawns | 101 | 101 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-100 | bytesCollected | 409600 | 409600 | 1.000 | 1.000 to 1.000 | equal |
| perf-14-docker-artifacts | nested-100 | elapsedMs | 2020 | 1920 | 1.039 | 0.969 to 1.086 | no difference |
| perf-14-docker-artifacts | nested-100 | process.maxRssBytes | 60473344 | 60522496 | 1.000 | 0.998 to 1.001 | no difference |
| perf-14-docker-artifacts | nested-100 | childWallMs | 2496 | 2176 | 1.012 | 0.891 to 1.062 | no difference |
