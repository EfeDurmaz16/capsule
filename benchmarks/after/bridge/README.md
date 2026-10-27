# M3 bridge worker measurements

Host: darwin 25.6.0 arm64, Apple M5 Pro, 18 cpus, 48 GiB. The host ran other work at the same time (load average about 9), so wall times move by 10 to 30 percent between runs. Numbers describe this host only. They are not provider latency claims.

## Bridge worker (fixture profile)

`node benchmarks/run.mjs --label bridge-m3-node22 --only m3-bridge-worker` with the built worker, three repetitions per case, every repetition kept under `raw/`. The fixture provider is in memory, so a round trip is framing, the worker and the Capsule facade, not a provider.

| Metric (median of repetitions)                     | Node 22.23.2     | Node 24.19.0     |
| -------------------------------------------------- | ---------------- | ---------------- |
| spawn to decoded hello_ack, p50 of 20 fresh spawns | 29.8 ms          | 31.3 ms          |
| worker peak RSS after hello_ack                    | 47.2 MiB         | 53.8 MiB         |
| exec round trip p50 / p95, 500 sequential          | 0.081 / 0.179 ms | 0.071 / 0.167 ms |
| create round trip p50, 100                         | 0.073 ms         | 0.047 ms         |
| destroy round trip p50, 100                        | 0.067 ms         | 0.044 ms         |
| policy refusal round trip p50, 100                 | 0.051 ms         | 0.034 ms         |
| worker peak RSS after 800 requests                 | 62.9 MiB         | 76.8 MiB         |

Before the shared operation context fix in `@capsule-sdk/core` (commit 575c614), the same exec round trip measured 0.44 ms p50 on Node 22 at 500 requests and grew to 2.7 ms per request by 2500 requests, because each per-request Capsule left an AsyncLocalStorage that every later async resource visited. After the fix, 8000 sequential requests run at about 0.04 ms each in process, with heap after GC at 10.8 MiB.

## Docker profile (local engine)

`pnpm bridge:docker-smoke` on OrbStack, Docker 29.4.0, image `debian:bookworm-slim` already present, never pulled. `docker-smoke-node22.json` holds every raw timing and the checks. Docker numbers are dominated by the docker CLI and the engine: exec p50 110 to 150 ms across runs, create 380 to 500 ms, destroy 270 to 600 ms, and spawn to hello_ack 35 to 39 ms.

## Hot paths against the M1 head

`control/` holds a same-session run of perf-01 (core receipts), perf-09 (CLI cold start) and perf-10 (Docker output capture) on the M1 head (`raw-control-m1-node22`) and on this branch (`raw-m3-node22`). Alternating reruns put perf-01 throughput within 12 percent either way, CLI cold start within noise, and perf-10 at 1.0x to 1.17x for 10 MiB and 1.0x to 1.13x for 100 MiB. Nothing measured is more than 1.5x slower.

## Fabric's client against this worker

Fabric's `crates/fabric-bridge` (Fabric commit `61285cc`, `crates/fabric-bridge/tests/capsule_worker.rs`) spawned this worker built from a clean clone of commit `9f5d65e` (`pnpm install --frozen-lockfile`, then `pnpm --filter "@capsule-sdk/bridge-worker..." run build`, pnpm 10.32.1) and drove it over its stdio with Fabric's own framing, parser, client and journal. `fabric-client/` keeps that run:

- `interop/run.log` (Node 22.23.2) and `interop/run-node24.log` (Node 24.19.0): all 7 tests pass. Every shared scenario is replayed over the worker's pipes and each answer equals the fixture except `message` strings; Fabric's client runs create, exec, observe and destroy, every refusal, a repeated key and a worker killed mid-request on the fixture profile, and the Docker profile on OrbStack with `debian:bookworm-slim`, never pulled.
- `interop/mutations.log`: removing the worker's owner check or its image policy check from the built bundle makes those tests fail.
- `test/` and `release/`: every raw sample of Fabric's `capsule_worker_latencies` bench, 15 per path, in microseconds, timed from Fabric (the profile is Fabric's build; the worker is the same). `machine.txt` records the host and load.

| Path, timed from Fabric (p50 of 15)                      | Fabric test profile | Fabric release profile |
| -------------------------------------------------------- | ------------------- | ---------------------- |
| fixture worker spawned, handshake answered               | 30.8 ms             | 29.0 ms                |
| fixture create round trip, in-memory log                 | 0.24 ms             | 0.18 ms                |
| fixture exec round trip, in-memory log                   | 0.25 ms             | 0.16 ms                |
| fixture create round trip, journal (two fsynced commits) | 8.0 ms              | 8.0 ms                 |
| docker worker spawned, handshake answered                | 33.7 ms             | 29.3 ms                |
| docker create round trip                                 | 201 ms              | 192 ms                 |
| docker exec round trip                                   | 88.6 ms             | 88.7 ms                |
| docker destroy round trip                                | 231 ms              | 221 ms                 |

Against Fabric's Rust test double the same spawn is about 1.6 to 1.9 ms and a create round trip 0.05 to 0.15 ms (Fabric `docs/evidence/m3-interop`), so Node startup and the worker's own work are what this worker adds. The journal round trip is the same 8 ms with either worker: it is Fabric's fsync.
