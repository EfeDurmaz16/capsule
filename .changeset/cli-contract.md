---
"@capsule-sdk/cli": minor
---

The `capsule` command now keeps a stable contract, documented in `docs/cli.md`.

- `--version` (or `-v`) prints only the version. Help (`--help`, `-h`, `help <command>`) prints per-command usage, options and examples on stdout and exits 0.
- Parsing is strict. An unknown command, action or option, an option the command does not read, or a stray argument exits 2 with a one-line hint before any work; a typo such as `--adaptr` no longer falls back to the default adapter. The command a container runs must follow `--`.
- `capsule run` and `capsule sandbox` forward the program's stderr, keep its stdout unchanged, and print the receipt as one line on stderr instead of JSON on stdout. With `--json` they print one document with both streams and the receipt.
- Failures exit 1 (operational) or 2 (usage), 130 when a confirmation is declined. With `--json` a failure prints one JSON line on stderr with a stable `reason`; SDK error codes map to reasons in one place.
- `capsule doctor` checks the user's machine (Node, Docker, `capsule.config.json`, credential variables) instead of Capsule's own repository, and exits 0 when the selected adapter is ready.
- `service delete`, `neon branch-delete` and `preview destroy` ask before deleting. Without a terminal, in CI, or with `--non-interactive`, they need `--yes`.
- Color is off unless stderr is a terminal; `--no-color`, `NO_COLOR` and `FORCE_COLOR` are honored. JSON on stdout is compact unless stdout is a terminal.
- The published bundle is minified with function names kept, and declaration maps are no longer packed.
