# Capsule CLI

`capsule` runs work on one runtime at a time, checks policy before each provider call, and records a receipt. This page is the CLI contract: what scripts and agents can depend on. Task-by-task usage is in the [operations guide](operations-guide.md); `capsule <command> --help` prints the options of each command.

Until the npm release, `capsule` means `node packages/cli/dist/index.js` after `pnpm build` in the repository.

## Commands

```text
capsule <command> [<action>] [options] [-- <command>...]
```

| Command                                                       | Does                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `run`                                                         | Run a command in a one-off container; its stdout and stderr are the program's own   |
| `sandbox`                                                     | Create a sandbox, run one command in it, then destroy it                            |
| `gc`                                                          | Find what crashed or ended runs left behind, and remove it (asks first)             |
| `capabilities`                                                | Show what an adapter supports                                                       |
| `doctor`                                                      | Check this machine: Node, Docker, and provider credentials                          |
| `policy explain`                                              | Explain a policy decision without calling a provider                                |
| `receipt verify`, `receipt inspect`                           | Verify or inspect stored receipts                                                   |
| `audit export`                                                | Receipts and their policy decisions as JSONL, by time window (`--since`, `--until`) |
| `job`, `service`, `machine`, `edge`, `neon`                   | Provider operations                                                                 |
| `preview plan`, `preview create`, `preview destroy`           | Preview environments                                                                |
| `preset`, `select`, `compare`, `classify`                     | Planning reports                                                                    |
| `init`, `examples`, `adapter scaffold`, `live-test`, `verify` | Project and repository tools                                                        |
| `completion bash\|zsh\|fish`                                  | Shell completion script                                                             |

`capsule`, `capsule --help`, `capsule -h` and `capsule help` print the root help. `capsule <command> --help` and `capsule help <command>` print one command's help. A command with actions, run without one (`capsule receipt`), prints its help. `job` and `service` have documented default actions (`run` and `deploy`). Help goes to stdout, exits 0, and does no work: it does not read `capsule.config.json` or contact a provider.

`capsule --version` (or `-v`) prints only the version, at any depth. With `--json` it prints `{"version":"0.1.1"}`. When both `--help` and `--version` are given, help wins.

## Global options

| Option              | Effect                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| `--json`            | Print one JSON document on stdout; a failure prints one JSON line on stderr |
| `--non-interactive` | Never prompt                                                                |
| `--no-color`        | Turn off color                                                              |
| `--debug`           | Add the stack trace to a failure                                            |
| `-h`, `--help`      | Show help                                                                   |
| `-v`, `--version`   | Print the version                                                           |

## Parsing

Parsing is strict and happens before any work, before the config file is read, and before any provider is created:

- An unknown command or action fails with exit 2 and names it.
- An unknown option fails with exit 2, names it, and suggests at most one close match: `capsule capabilities --adaptr e2b` fails; it never falls back to the default adapter.
- An option that the command does not read fails with exit 2 (`capsule doctor --image busybox`).
- An extra positional argument fails with exit 2.
- The command a container runs goes after `--`, and only `run`, `sandbox` and `job run` accept one. `capsule run --image busybox echo hi` fails and asks for `--`; nothing is ever appended to a container command.
- A string option without a value, a boolean option with a value, and a `--port` that is not 1 to 65535 fail with exit 2.
- A known option is never read as another option's value: `capsule run --image --json` fails with `missing_value`. A value that starts with a dash can be attached with `=` (`--name=-x`).
- Without a command, only global options are allowed: `capsule --jsn` and `capsule --image busybox` fail with exit 2 instead of printing help.
- An invalid value for a command's own arguments (an unknown preset, example, provider or domain) fails with exit 2.

Each failure is two lines on stderr: the error, then a hint.

```text
$ capsule capabilities --adaptr e2b
Error: Unknown option --adaptr for capsule capabilities.
Did you mean --adapter? Run capsule capabilities --help for usage.
```

## Streams

stdout carries the answer and nothing else. Everything that is not data goes to stderr.

- `capsule run` and `capsule sandbox` write the program's stdout to stdout and its stderr to stderr, unchanged, then one line on stderr: `capsule: ran on docker, exit 3, receipt <id> in <file>`. The exit code is the program's. The receipt never goes to stdout; `--receipt-file <file>` (or `receipts.path` in `capsule.config.json`) appends it to a JSONL file. Without one the receipt is not saved, and the line says so.
- Report commands (`capabilities`, `doctor`, `preset list`, `select`, `compare`) print a table by default and JSON with `--json`.
- Other commands print JSON results.
- JSON on stdout is pretty-printed for a terminal and one compact line otherwise. Do not depend on whitespace or key order.

## JSON mode

With `--json`, a successful run prints exactly one JSON document on stdout and nothing on stderr. `run --json` holds both streams of the program:

```json
{
  "job": { "adapter": "docker", "image": "busybox", "command": ["sh", "-c", "work"], "status": "succeeded", "exitCode": 3, "stdout": "...", "stderr": "..." },
  "receipt": { "id": "..." },
  "outcome": "ran"
}
```

A failure prints nothing on stdout and one single-line JSON document on stderr:

```json
{ "status": "action_required", "reason": "unknown_option", "message": "Unknown option --adaptr for capsule capabilities.", "data": { "options": ["--adaptr"] } }
```

| Field                | Meaning                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | `action_required` when the run was blocked before any effect and a change of input or a confirmation lets it run; `error` otherwise |
| `reason`             | Stable snake_case code, listed below. Branch on this, never on `message`                                                            |
| `message`            | The human headline. Its wording can change                                                                                          |
| `next`               | Recovery commands, as `[{ "command", "argv" }]`, when there is one                                                                  |
| `data`               | Context, such as the SDK error `code` or the `operation` of an unknown outcome                                                      |
| `retryable`          | Present and `true` only when running the same command again is safe                                                                 |
| `userActionRequired` | Present and `true` when a person must confirm                                                                                       |

## Exit codes

| Code           | Meaning                                               | Reasons                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0              | Done, including help, version, and an empty result    |                                                                                                                                                                                                                                          |
| 1              | Operational failure                                   | `unsupported_capability`, `policy_denied`, `provider_auth`, `provider_rejected`, `rate_limited`, `provider_unavailable`, `pending`, `unknown_outcome`, `partial_failure`, `cleanup_failed`, `provider_error`, `failed`, `internal_error` |
| 2              | Usage error or missing input                          | `unknown_command`, `unknown_option`, `invalid_arguments`, `missing_value`, `unknown_adapter`, `invalid_config`, `action_required`                                                                                                        |
| 130            | Canceled: Ctrl+C, or a declined confirmation          | `canceled`                                                                                                                                                                                                                               |
| 128 + n        | Ended by signal n                                     |                                                                                                                                                                                                                                          |
| Program's code | `run` and `sandbox` exit with the program's exit code |                                                                                                                                                                                                                                          |

Some commands exit 1 for a negative report without an error: `doctor` when the selected adapter is not ready, `receipt verify` when a receipt is invalid, `preview plan` when validation fails, `preview destroy` when cleanup is `partial`, `verify providers` and `live-test validate` when a provider is not ready. SDK errors map by their `code` (for example `CAPSULE_OPERATION_OUTCOME_UNKNOWN` becomes `unknown_outcome`). An unknown outcome is not retryable: inspect the resource before running the command again.

## Non-interactive mode and consent

Capsule asks before a delete: `service delete`, `neon branch-delete`, `preview destroy`, and `gc`. The prompt goes to stderr and defaults to No; anything but `y` or `yes`, Ctrl+C, or Ctrl+D changes nothing and exits 130. `--yes` answers it.

A run is non-interactive when `--non-interactive` or `--json` is passed, `CI` is set, or stdin or stderr is not a terminal. A non-interactive run never reads stdin for an answer: a delete without `--yes` fails before any effect with exit 2, reason `action_required`, and a `next` command that adds `--yes`. `--yes` confirms only; `--force` keeps its provider meaning (force a delete where the provider supports it, or overwrite files for `init` and `adapter scaffold`).

`preview destroy` reads and validates the cleanup file before it asks, so a malformed or foreign plan fails first.

## Color

Color marks only the `Error:` prefix; the text says the same thing without it. Precedence, highest first: `--no-color`, a nonempty `NO_COLOR`, `FORCE_COLOR` (`0` turns it off), then whether stderr is a terminal (off for pipes and `TERM=dumb`). JSON and help are never colored.

## Environment and configuration

| Source                                                   | Effect                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags                                                    | Win over everything below                                                                                                                                     |
| `capsule.config.json` in the working directory           | Default `adapter`, `policyFile`, and `receipts.path`. An invalid file fails every command except `doctor` (reason `invalid_config`, exit 2), which reports it |
| Provider variables (`E2B_API_KEY`, `FLY_API_TOKEN`, ...) | Read by the adapters; `capsule doctor` shows which are set, never their values                                                                                |
| `CI`, `NO_COLOR`, `FORCE_COLOR`, `TERM`                  | Interaction and color, above                                                                                                                                  |

With no adapter from a flag or the config, Capsule uses `docker`. An unknown adapter name fails with exit 2 and lists the valid names.

## gc

A run can die before it cleans up: `kill -9`, a crash, a closed laptop. `capsule gc` finds what it left and removes it.

On an adapter that can list what it labelled (Docker today), `run`, `job run` and `sandbox` write a job lease before the first provider call, and every create carries two labels: `capsule_operation` (new per create) and `capsule_job`. The lease names the host and process. A run that returns deletes it (for `sandbox`, once the sandbox is destroyed); any other end leaves it, marked ended. Leases live in `CAPSULE_STATE_DIR/jobs`, else `XDG_STATE_HOME/capsule/jobs`, else `~/.local/state/capsule/jobs`, so `gc` works from any directory on the same machine.

`gc` lists every container with a `capsule_operation` label and decides for each one:

| Owner     | Meaning                                                              | gc         |
| --------- | -------------------------------------------------------------------- | ---------- |
| `live`    | the lease's process is running                                       | keeps it   |
| `exited`  | the lease's process is gone (killed or crashed)                      | removes it |
| `ended`   | the run ended without removing it                                    | removes it |
| `unknown` | no job label, no lease on this machine, or a lease from another host | keeps it   |

`gc --dry-run` only reports. Without it, `gc` prints the report to stderr and asks; without a terminal it needs `--yes` (exit 2, `action_required`). The answer covers the resources shown: each removal gets its own grant, made then, valid for 60 seconds, scoped to `sandbox.destroy` alone and that one resource. A grant that allows anything else (a create, `edge.version`, `service.update`) is refused, so the grant that made or changed something never removes it. Every removal writes a `sandbox.destroy` receipt with `metadata.gc` (the owner verdict) and `metadata.reason` (`--reason`), and counts as `removed` only when a second listing no longer shows it; otherwise it is `unconfirmed`. Job containers are reported and `skipped`. Without `--dry-run`, `gc` then deletes every lease on this machine for this adapter whose job ended or whose process is gone and that has nothing listed any more: its resources were removed, or it failed or was killed before it created anything. Exit 1 (`cleanup_failed`) when any residual is `denied`, `failed` or `unconfirmed`.

A reused process id reads as `live`, so a resource can be kept that could have gone; it is never the other way round.

## doctor

`capsule doctor` checks the machine it runs on, not Capsule's repository: the Node version, whether Docker answers, whether `capsule.config.json` is present and valid, and the provider credential variables. It exits 0 when the selected adapter (`--adapter`, the config, or `docker`) can be used now: Docker reachable for `docker`, required variables set for a cloud adapter. Otherwise it exits 1 and says what is missing on stderr. Adapters that also read a default credential chain (AWS, Google Cloud, Kubernetes) are not blocked by a missing variable. `--provider <name>` limits the credential table.

## Output that is not covered

Error text, help text, table layout and the human receipt line are for people and can change between versions. JSON shapes, reasons, exit codes, option names and stream assignments are the contract; a change to them is a breaking change and is recorded in the changelog.
