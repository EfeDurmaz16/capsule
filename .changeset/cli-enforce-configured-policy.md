---
"@capsule-sdk/cli": minor
---

Enforce the configured policy on CLI executions.

`--policy-file`, or `policyFile` from `capsule.config.json` when the flag is absent, was only read by `capsule policy explain`. It is now loaded once, frozen, and passed to every Capsule the CLI creates for `run`, `sandbox`, `job`, `service`, `machine`, `edge`, `neon` and `preview plan/create/destroy`, including each preview child. A denied policy (for example `approvals.required` with no grant) now stops the command before any provider call, and `network.mode: "none"` reaches the Docker arguments. A selected policy file that is missing, is not JSON, is not an object, has an unknown top-level section or an invalid `network.mode` fails before any provider is created. Projects scaffolded by `capsule init` will now have their scaffolded policy applied, including its deny-all `secrets.allowed: []` and output limits.
