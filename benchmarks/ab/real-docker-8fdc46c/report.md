# Interleaved A/B: real-docker-8fdc46c

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 15.

A (anchor) 7d3a28a8c0e9b9282b1079ea3d2fc61c32c6f8f7 packages tree 66b109a5e72fdc418d86eb0b060443863ebcf346; B (candidate) 8fdc46cb331b811e14950e283d5b825788b5a07e packages tree cf7875190d8205697a7a93db8194dc50e04485b3.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 16.6/18.3/19.1, at end 19.1/21.8/20.8.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| perf-14-docker-artifacts | real-docker-paths-10 | bytesCollected | 4096 | 40960 | 10.000 | 10.000 to 10.000 | changed |
| perf-14-docker-artifacts | real-docker-paths-10 | elapsedMs | 578 | 319 | 0.542 | 0.515 to 0.603 | better |
| perf-14-docker-artifacts | real-docker-paths-10 | process.maxRssBytes | 52559872 | 57671680 | 1.098 | 1.095 to 1.103 | worse |
| perf-14-docker-artifacts | real-docker-paths-10 | childWallMs | 2615 | 2619 | 0.849 | 0.711 to 1.179 | no difference |
| perf-14-docker-artifacts | real-docker-paths-100 | bytesCollected | 4096 | 409600 | 100.000 | 100.000 to 100.000 | changed |
| perf-14-docker-artifacts | real-docker-paths-100 | elapsedMs | 4483 | 1845 | 0.387 | 0.342 to 0.439 | better |
| perf-14-docker-artifacts | real-docker-paths-100 | process.maxRssBytes | 57753600 | 59736064 | 1.023 | 1.013 to 1.048 | worse |
| perf-14-docker-artifacts | real-docker-paths-100 | childWallMs | 6364 | 3624 | 0.539 | 0.496 to 0.631 | better |
