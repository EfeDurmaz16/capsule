# Import cost of @capsule-sdk/core: the two childWallMs rows

Question (decision 4 of 2026-11-02, under Efe's delegation of that day): the A/B in report.md shows
perf-01 parallel-required-delayed-a childWallMs 2164 to 2174 ms (1.004) and perf-04 idle-limit-10
3044 to 3057 ms (1.003), 10 to 13 ms per process, attributed to import-time work the M3/M4 core commits
(575c614 operation context, 2dc1196 attach, 2978dac hashing) added. One bounded attempt to remove it
at its cause, proven by a counted measure, not timing.

## Counted measure

A fresh `node --expose-gc` process imports one built `@capsule-sdk/core` bundle and records, after a
GC, the heap it added and the Node internal modules it loaded (`process.moduleLoadList` before and
after). Each tree was bundled from its own `packages/core/src` with this checkout's tsup; no timing.

| tree | heap after import | internal modules loaded | bundle bytes |
| --- | --- | --- | --- |
| 7d3a28a8 (the A/B anchor) | 950 KiB | 49 | 130852 |
| 2dc1196^ (before attach) | 986 KiB | 49 | 147453 |
| 2dc1196 attach | 987 KiB | 49 | 148401 |
| 575c614 operation context | 989 KiB | 49 | 148770 |
| 2978dac hashing | 987 KiB | 49 | 147618 |
| 34f2a2d (main, M1 and M3 merged) | 989 KiB | 49 | 148935 |
| cbae016 (this branch) | 989 KiB | 49 | 148935 |

The 49 internal modules are the same list in every row: `node:crypto` and the streams it pulls (37 of
the 49, from the top-level `createHash` and `randomUUID` imports that the anchor already had), the
`node:fs` promise, dir and watcher modules the ESM import of `node:fs` touches, and
`internal/async_local_storage/async_hooks`, which the anchor's per-instance `AsyncLocalStorage` import
also loaded. The three commits add 3 KiB of heap between them and no module; the 39 KiB between the
anchor and main is the bundle growing by 18 KB in the M1 window (bounds.ts, lifecycle.ts, errors.ts),
not these commits.

## Reproduce

`measure-import.mjs` next to this file is the script behind the table. It takes one built ESM entry, runs a
GC, imports it, runs a GC again and prints the heap it added in KiB and the Node internal modules that
appeared in `process.moduleLoadList` (count and names). For one tree, from the repository root on Node 22:

```sh
pnpm --filter @capsule-sdk/core build
node --expose-gc benchmarks/ab/m4-perf-recheck-c7254d8/measure-import.mjs packages/core/dist/index.js
```

For an earlier tree, check it out in a scratch directory, build its `packages/core` with this checkout's
tsup (`tsup <tree>/packages/core/src/index.ts --format esm --out-dir <scratch>`) and point the script at
the bundle. Rerun on this branch's head: `{"heapDeltaKiB":989,"internalModulesAdded":49}`, the row above.

## What the two cases do

- perf-04 idle-limit-10 makes one `capsule.edge.logs` call and waits on a 3 s watchdog
  (`benchmarks/workloads/perf-04-vercel-log-streams.mjs`, params `{ limit: 10, deadlineMs: 3000 }`).
  One operation: one frame object and one chain lookup in the shared operation context.
- perf-01 parallel-required-delayed-a runs 40 iterations of two concurrent execs with a 50 ms delayed
  receipt write (`benchmarks/workloads/perf-01-core-receipts.mjs`). 80 operations; its own headline
  metric, bLatencyMs.p50, went from 53 ms to 3.8 ms in the same A/B.

## Outcome

Import-time work is not the cause: the module set is identical from the anchor to this branch and the
three commits account for 3 KiB of heap. Nothing is loaded lazily or made cheaper, because the counted
measure finds nothing at import to remove, and a change made on that premise would be guesswork. The
per-process difference, 10 to 13 ms on processes that sleep for 2 to 3 s and run one or eighty
operations, is not reachable from a single operation's frame allocation either; it sits in process
wall time outside core's import and operation path (bundle parse of 18 KB more code at most, the
watchdog's resolution, host load during the A/B, which report.md records at 6.0 to 6.9), and this
attempt stops here as the decision says.
