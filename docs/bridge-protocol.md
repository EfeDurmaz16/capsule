# Fabric bridge protocol

Capsule can run as a provider worker for [Fabric](https://github.com/EfeDurmaz16/fabric), a durable job runner. Fabric spawns the worker as a local child process and sends it one governed provider action at a time over framed stdio. This page is a pointer. The specification lives in Fabric and is the single source of truth:

- Specification: Fabric `docs/bridge-protocol.md` (bridge protocol v1).
- Decision record: Fabric `docs/adr/0021-capsule-provider-bridge.md`, adopting drafts P09 (scoped provider identity and truthful outcomes) and P10 (Capsule worker protocol) as Proposed.

Status: proposed, 2026-10-27; amended 2026-10-29 (an exec bound of 0 is invalid; an observe carries the original operation's scope; both profiles observe an exec; fixture seeds carry the operation label). The worker is implemented in [`@capsule-sdk/bridge-worker`](../packages/bridge-worker) and passes every shared fixture; it is not released yet.

## What Capsule owns

| Concern                                                                                | Owner          |
| -------------------------------------------------------------------------------------- | -------------- |
| Job, task, attempt and operation identity, the operation journal, placement, fencing   | Fabric         |
| Provider mapping, provider calls and observations, receipts, Capsule policy evaluation | Capsule worker |

The worker keeps no durable job state. A worker restart is transport loss, never cancellation, and never a reason to retry an action.

## Rules that touch existing Capsule types

- The wire locator is Capsule's `ResourceLocator` in snake case: `provider`, `scope`, `kind`, `native_id`, optional `native_operation_id`. Every effect and result carries it.
- A terminal-only action that does not reach a terminal state within its deadline answers `pending` with the locator, last state, observation count and deadline, the shape of `PendingOperationError`. An action whose effect cannot be known answers `unknown` with the best known locator, the shape of `UnknownOutcomeError`.
- Refusals (`invalid`, `unsupported`, `denied`, `unavailable`) happen before any provider call and carry `effect: "none"`.
- Fresh per-operation approval is additive: it never overrides a policy deny, and a create grant never authorizes destroy.
- A present secrets block with omitted `allowed` denies all secrets; two allowlists merge by intersection.

## Fixtures

`protocol/bridge/v1` in this repository is a byte-identical copy of Fabric's `protocol/bridge/v1`: framed byte cases, message cases, scenarios for the deterministic fixture provider, and the v1 capability profiles for the fixture provider and local Docker. `scripts/bridge-fixtures.test.mjs` checks every file against `manifest.sha256` and pins the manifest's own sha256; Fabric pins the same digest. Never edit these files in one repository alone: a change lands byte for byte in both, with the pin, in linked pull requests. Fabric's text stays the source of truth; the 2026-10-29 fixtures for observe scope, exec observe and seed operation labels were written here and copied to Fabric. Until v1 first ships, a correction goes into v1 this way rather than into a v2 (the specification's Versioning section). Prettier ignores the directory so its bytes stay exact.

## The worker

`@capsule-sdk/bridge-worker` ships the `capsule-bridge-worker` bin. One process serves one capability profile:

```sh
pnpm build
node packages/bridge-worker/dist/bin.js --profile fixture --config worker.json
node packages/bridge-worker/dist/bin.js --profile docker --config worker.json --receipts receipts.jsonl
```

Installed from npm the same command is `capsule-bridge-worker --profile <fixture|docker> --config <file>`. The config holds the scope the worker is bound to (`binding`), the worker's policy (`images`, `secrets.allowed`) and the approval grants it can resolve by ref (`approvals`); a scenario's `provider_state` is a valid fixture config. For Docker, `binding.engine` names a docker context, and every docker command the worker runs names it with `--context=`, so the engine scope on a locator is the engine the command reaches. `binding` may be omitted; the scope is then read once from `docker context show` and kept, even if the CLI's current context changes later.

The worker also builds as one executable that needs no Node, Bun or pnpm on the host, a Node single executable application: `pnpm build && pnpm bridge:sea` bundles the bin the package ships and runs `node --build-sea`, so the build needs Node 25.5 or later (Node 26 LTS; Node 22 and 24 would need a separate injector) and the executable embeds that Node. It is built for the platform it is built on, and signed ad hoc on macOS. `pnpm bridge:artifact-smoke` copies it to a fresh directory, runs it with an empty PATH, and replays every shared scenario, the refused frame fixtures and SIGTERM and SIGINT over its stdio. The CI job `bridge-artifact` does both on Linux x64.

How the worker applies the protocol:

- Checks run in a fixed order and stop at the first failure, all before any provider call: frame, JSON, message schema, action in profile, locator scope, idempotency, owner, policy (images, secrets), fresh approval. Then the request goes through the Capsule facade, which checks policy and the grant again before the adapter runs. Idempotency is checked before policy, because the shared scenario `duplicate_idempotency_key` expects a conflict for a changed request that policy would also refuse; the specification lists the same order.
- The idempotency table holds up to 4096 keys and at most 16 Mi characters of exec output across its answers. Past that the oldest answers are dropped and only their key and digest stay, so a repeat of such a key is refused as `idempotency_conflict` and never runs again. Fabric never repeats a key, so this costs it nothing.
- An observe names the original operation's `scope` (`job`, `task`, `attempt`, `generation`, under the request's rules); one without it is `invalid`/`missing_field`. The worker reads the resource's labels before it reports anything: a resource another job made, or no job, is refused as `denied`/`owner_mismatch` for every action, so a destroy observe never settles on another job's resource. A create observe also needs the resource's operation label to be the observing operation; a resource with this job's label alone is refused. A fixture seed (`sandboxes[]`) that names `owner_job` carries `operation` too, as every container the Docker profile creates carries both labels, and the fixture provider refuses a seed with one and not the other. Every effect the fixture provider records carries the operation id it was made for.
- An observe of `sandbox.exec` is answered from the worker's exec ledger, which holds every exec this worker process sent, by operation id: the exec's own `completed` or `cancelled` result once the command ended (with its output, `replayed: false`), `pending`/`observation_deadline` with `state: "running"` while it runs past `wait_ms`, and `unknown`/`observation_failed` with the locator for an exec this process did not send or no longer holds. A ledger record names the exec's sandbox and job, and an observe naming another is `denied`/`owner_mismatch`. Nothing runs the command again. The ledger is bounded like the idempotency table: at most 1024 records and 16 Mi characters of output text in ended records, oldest ended record dropped first; a running record is never dropped. It does not survive the worker, so an exec answered `running` before a worker loss is `unknown` to the next worker.
- An existing resource is reached with `Capsule.sandbox.attach`, which changes nothing and carries no create grant, so exec and destroy are governed per operation.
- A grant resolved from an approval ref is scoped to exactly that action, and to that resource when the grant names one. The ref never reaches receipts or logs.
- Secret values are read only for names the worker's own policy allows, at the execution boundary. Docker reads them from the worker's environment; nothing else does.
- The fixture profile runs on a virtual clock: each observation advances 1000 ms, so deadlines and observation counts are exact on any host. Docker uses the wall clock with 250 ms between observations. On the wall clock every wait ends at `deadline_ms` after the frame was read (`wait_ms` for an observe), so no answer comes after Fabric's own deadline: checks still reading then are refused before any effect (`provider_failed`/`provider_refused`); a create or destroy still in the docker CLI is answered `unknown` with the best locator, for a create the container name the worker gave it, which an observe by the original operation id resolves; an observation read still in flight is answered `pending`; and an exec is answered `running`, and an observe of its operation later reports how it ended. A provider can also accept an exec and run it on by itself; the worker then answers `running` at once (the fixture's `run_until_settle` does this, and its command ends at the next `advance: settle`). Work that goes on after its answer keeps counting against `max_in_flight` until it ends.
- The parser refuses exactly what the specification refuses. An exec `timeout_ms` or `max_output_bytes` of 0 is `invalid`/`limit`, a rule the specification and the shared cases `request_exec_timeout_zero` and `request_exec_output_bytes_zero` carry since 2026-10-29; Fabric refuses the same request before sending it. A request label in the `fabric.` namespace is overwritten by the worker's own labels, so it cannot claim another owner. Values a provider cannot take safely are refused by that profile before any call: the Docker profile refuses an image or container id that starts with a dash and a label key that holds `=`, because each becomes a docker CLI argument.
- The Docker profile creates with `--pull never`, labels each container `fabric.operation`, `fabric.job`, `fabric.attempt` and `fabric.generation`, refuses a container without this job's label, and finds an earlier create of the same operation by label after a worker restart instead of creating another.
- Losing stdin is a shutdown with a 0 ms drain and SIGTERM one with 5 s; open requests are answered pending or unknown, nothing is cancelled at the provider, and the process exits 0. A framing error or a refused hello exits 2. When the session ends, the Docker profile kills any `docker exec` client still attached, so no CLI process outlives the worker; the command keeps running in the container. Clients of create, start and rm are left to finish, because killing one could abort the daemon's work. A worker killed with SIGKILL cannot do this; only the process that spawned it can, by signalling the worker's process group.

Evidence: `packages/bridge-worker/src/*.test.ts` run all 18 scenarios, 50 cases and 15 frames and check that every refusal left the fixture provider's effect log empty; the pack smoke runs the packed bin outside the repository; `pnpm bridge:docker-smoke` proves the Docker profile on a local engine, and the CI job `bridge-docker-smoke` runs it with `--require` on a digest-pinned busybox the job pulls first; `benchmarks/after/bridge` holds spawn and round-trip measurements with raw data. From the other side, Fabric's `crates/fabric-bridge/tests/capsule_worker.rs` spawns this worker, replays every shared scenario over its stdio with Fabric's own framing and parser, and runs Fabric's client and journal against the fixture and Docker profiles; `benchmarks/after/bridge/fabric-client` holds that run's raw timings.
