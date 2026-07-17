# Operations Guide

Task-oriented reference for the Capsule CLI. Every command here is sourced from `capsule --help` and the docs it points to. Commands print human-readable tables by default; add `--json` where noted for stable automation output.

Build the CLI once, then invoke it from the workspace:

```bash
pnpm --filter @capsule-sdk/cli build
pnpm --filter @capsule-sdk/cli exec node dist/index.js <command>
```

A `capsule.config.json` in the working directory supplies a default adapter, `receipts.path`, and `policyFile`. Explicit flags (`--adapter`, `--receipt-file`, `--policy-file`) always override the config file.

## Scaffold a project: `init`

Write a starter Capsule project for one adapter.

```bash
capsule init --adapter docker --out-dir .
```

Prints the adapter, output directory, written files, an install hint, and notes. Use `--force` to overwrite existing files.

## Check the environment: `doctor`

Verify local prerequisites before running anything.

```bash
capsule doctor
```

Reports Docker availability, Node version support, workspace status, and release-audit availability. Exits non-zero if any of those are not ready, so it is safe to gate a script on it. Pass `--adapter <name>` to scope the check.

## Inspect adapter support: `capabilities`

Show what an adapter actually supports, straight from its declared capability map.

```bash
capsule capabilities                       # default adapter
capsule capabilities --explain             # add per-capability notes
capsule capabilities --json                # machine-readable
capsule capabilities --adapter neon
capsule capabilities --adapter cloud-run --project-id <gcp-project> --location us-central1
capsule capabilities --adapter kubernetes --namespace default
```

Support levels are honest: `native`, `emulated`, `experimental`, and `unsupported`. See [`docs/provider-matrix.md`](./provider-matrix.md) for the generated cross-provider view and [`docs/capability-model.md`](./capability-model.md) for the model.

## Explain a policy decision: `policy explain`

Show how a policy resolves for a given adapter, capability, and spec without executing anything.

```bash
capsule policy explain \
  --adapter docker \
  --capability job.run \
  --policy-file policy.json \
  --spec-file spec.json
```

Prints the resolved decision as JSON. Use it to confirm approvals, network mode, cost, and TTL constraints before a run. See [`docs/policy-model.md`](./policy-model.md).

## Verify receipts: `receipt verify`

Check the integrity of a receipt store, and optionally its signatures.

```bash
capsule receipt verify --receipt-file .capsule/receipts.jsonl
capsule receipt verify --receipt-file .capsule/receipts.jsonl --public-key ./capsule-receipts.pub --require-signature
capsule receipt verify --receipt-file .capsule/receipts.jsonl --require-signature --allow-unverified-signatures
```

Exits non-zero when the store is invalid. Signature flags:

- `--public-key <path-or-value>`: verify ed25519 signatures against this key (PEM path or inline PEM).
- `--require-signature`: fail receipts without a verified signature; a present-but-unverified signature also fails.
- `--allow-unverified-signatures`: downgrade `--require-signature` to a presence-only check when no `--public-key` is supplied.

See [`docs/execution-receipts.md`](./execution-receipts.md).

## Orchestrate previews: `preview create` / `preview destroy`

Create a multi-resource preview from a config file, and destroy it from the cleanup file the create step wrote.

```bash
capsule preview create --config-file preview.json --cleanup-file .capsule/preview-cleanup.json
capsule preview destroy --cleanup-file .capsule/preview-cleanup.json
```

`preview create` always exits zero on a completed plan. `preview destroy` exits non-zero only on a real cleanup failure (`partial`). Resources with no cleanup action by design (edge, job) resolve to `unsupported` and do not fail the destroy. For an end-to-end multi-provider run, see [`docs/real-orchestration-walkthrough.md`](./real-orchestration-walkthrough.md) and [`docs/preview-environments.md`](./preview-environments.md).

## Plan and validate live tests: `live-test plan` / `live-test validate`

Prepare a provider's live test without running it. Neither command prints secret values.

```bash
capsule live-test plan                       # all providers
capsule live-test plan --provider neon       # one provider
capsule live-test validate --provider neon   # check the current environment is ready
```

`live-test plan` maps a provider to its required env vars, optional env vars, project-scoped aliases, and copy-safe commands. `live-test validate` checks that the current environment satisfies those requirements and exits non-zero when a provider is not ready. Live tests still require `CAPSULE_LIVE_TESTS=1` and the provider credentials at run time. See [`docs/live-tests.md`](./live-tests.md) and [`docs/real-provider-quickstarts.md`](./real-provider-quickstarts.md).

## Run the bundled examples: `examples`

List the shipped examples, or run one by id.

```bash
capsule examples list
capsule examples run capability-check
capsule examples run capability-check --dry-run
```

`examples run` exits with the example's own exit code on failure. `--dry-run` reports what would run without executing it. Examples run credential-free in mock mode unless you provide live credentials.

## Other commands

The CLI also exposes provider selection and direct execution helpers, all listed in `capsule --help`:

- `verify providers [--provider <id>]`: verify provider adapters are wired correctly.
- `classify provider <provider> <service>`: classify a provider/service into a Capsule domain.
- `select provider --recipe <recipe>`: pick providers for a recipe (sandbox, agent-code-execution, preview-web-db, edge-web, service-api, machine).
- `compare providers --left <a> --right <b>`: compare two adapters' capabilities.
- `adapter scaffold <provider> --domain <domain>`: scaffold a new adapter package.
- `completion bash|zsh|fish`: emit a shell completion script.
- `run`, `sandbox`, `job`, `service`, `machine`, `edge`, `neon`: execute a single primitive against an adapter.

Run `capsule --help` for the full command list with example invocations.
