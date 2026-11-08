---
"@capsule-sdk/cli": patch
---

Close gaps in the CLI contract.

- Ctrl+C or Ctrl+D at a delete prompt now cancels with exit 130 instead of exiting 0 with nothing printed.
- A value-taking option no longer reads a known option as its value: `capsule run --image --json` fails with `missing_value`. Errors and results use the output mode from the same parse.
- An unknown option, or a command option given without a command, exits 2 instead of printing help.
- An invalid value for a command's own arguments (unknown preset, example, provider, domain, or a missing `--domain`) exits 2 with a usage reason instead of exit 1 and `failed`.
- A malformed `capsule.config.json`, policy, preview or spec file fails with the new reason `invalid_config` (exit 2) instead of `internal_error`.
- `--help` wins over `--version` when both are given.
- The human `run` line says when a receipt was not saved.
