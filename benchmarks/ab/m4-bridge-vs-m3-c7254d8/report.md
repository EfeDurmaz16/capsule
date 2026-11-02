# Interleaved A/B: m4-bridge-vs-m3-c7254d8

mock/synthetic: injected fake clients, local fake executables and generated files; no provider calls. Order: for each pair, for each case: A (anchor) then B (candidate), each in a fresh node --expose-gc process. Pairs: 20.

A (anchor) 91d4e0d5f2a3224fc678870240fd7aeb2a9d426d packages tree e9812d51ebb6aa06eaa8aa56b15c6197fd4ae7aa; B (candidate) c7254d825407e784674523b12313e8124ec7f061 packages tree 97fbe32be7f65a59b01329bc5d49ff98b29b4a59.

Host darwin 25.6.0 arm64, 18 CPUs (Apple M5 Pro), node v22.23.2; load average at start 4.9/5.8/6.4, at end 5.2/5.8/6.3.

Statistic: median of per-pair ratios B/A; 95% bootstrap interval from 10000 resamples of pairs (mulberry32 seed 1). Verdict "worse"/"better" only for cost or throughput metrics and only when the whole interval is on one side of 1; other counts say "changed" or "same".

| Workload | Case | Metric | A median | B median | B/A median | 95% CI | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| m3-bridge-worker | spawn-to-hello-ack | spawnToHelloAckMs.p50 | 28.417 | 28.713 | 0.997 | 0.985 to 1.045 | no difference |
| m3-bridge-worker | spawn-to-hello-ack | spawnToHelloAckMs.p95 | 31.318 | 31.98 | 1.010 | 0.991 to 1.048 | no difference |
| m3-bridge-worker | spawn-to-hello-ack | workerMaxRssBytes.p50 | 49553408 | 49545216 | 1.000 | 0.999 to 1.000 | no difference |
| m3-bridge-worker | spawn-to-hello-ack | process.maxRssBytes | 53870592 | 53886976 | 1.000 | 1.000 to 1.001 | no difference |
| m3-bridge-worker | spawn-to-hello-ack | childWallMs | 661 | 675 | 1.005 | 0.982 to 1.054 | no difference |
| m3-bridge-worker | request-round-trip | execRoundTripMs.p50 | 0.079 | 0.079 | 0.993 | 0.969 to 1.017 | no difference |
| m3-bridge-worker | request-round-trip | execRoundTripMs.p95 | 0.19 | 0.188 | 1.007 | 0.955 to 1.036 | no difference |
| m3-bridge-worker | request-round-trip | createRoundTripMs.p50 | 0.066 | 0.064 | 0.980 | 0.948 to 1.005 | no difference |
| m3-bridge-worker | request-round-trip | destroyRoundTripMs.p50 | 0.062 | 0.052 | 0.829 | 0.808 to 0.858 | better |
| m3-bridge-worker | request-round-trip | refusalRoundTripMs.p50 | 0.048 | 0.05 | 1.013 | 0.973 to 1.090 | no difference |
| m3-bridge-worker | request-round-trip | workerMaxRssBytes | 66265088 | 66207744 | 0.998 | 0.997 to 1.000 | better |
| m3-bridge-worker | request-round-trip | process.maxRssBytes | 54124544 | 54140928 | 1.000 | 0.999 to 1.001 | no difference |
| m3-bridge-worker | request-round-trip | childWallMs | 141 | 138 | 0.984 | 0.968 to 0.999 | better |
