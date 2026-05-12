# Adapter Contract

An adapter exports `name`, `provider`, `capabilities`, optional `raw`, and one or more domain adapter objects.

Every adapter must declare capability support using:

- `native`: provider supports the capability directly.
- `emulated`: Capsule or the adapter approximates it.
- `unsupported`: unavailable.
- `experimental`: available but unstable, incomplete, or provider behavior is still being validated.

Unsupported domains should be omitted or marked unsupported in the capability map. Adapters must not silently emulate without marking the support level.

The `raw` escape hatch is allowed for provider-specific clients or metadata. It should not replace the common domain contract.

Adapter contract tests should verify capability maps, unsupported capability errors, policy propagation, receipt attachment, and realistic domain results. Provider teams can maintain official adapters by owning capability maps, docs, and contract tests.
