# @capsule-sdk/ai

## 0.2.0

### Minor Changes

- cbe11d3: `createOpenAIResponsesFunctionTool` now sends a schema that follows the OpenAI strict function-calling rules it declares with `strict: true`. Its `parameters` are the new `codeExecutionInputStrictJsonSchema`: every property is listed in `required`, the optional `language` and `timeoutMs` accept `null`, and `command` uses `anyOf` over the same two disjoint branches instead of `oneOf`, so it accepts the same values. `descriptor.execute` now accepts the strict arguments (`CodeExecutionStrictInput`) and passes a `null` optional field to the tool as absent. The generic `codeExecutionInputJsonSchema` and the other wrappers are unchanged. The new `toOpenAIStrictJsonSchema(schema)` normalizes a JSON Schema the same way and throws on keywords strict mode does not support and on any object that allows additional properties, such as a map, instead of closing it.
- 89a2b5e: `createCodeExecutionTool` no longer lets a sandbox destroy failure overwrite the execution outcome. When execution completed and only destroy failed, `execute` resolves with the completed result plus a `cleanup` report (`status: "failed"`, a safe `residual` locator for the sandbox that may still exist, and the teardown error message), so framework wrappers never turn a finished command into a tool error that invites running it again. When execution failed and destroy failed too, it throws `CleanupFailureError` whose `effects` record (read with `partialEffectsOf`) keeps the primary execution error separately from the cleanup error, with the sandbox locator; its `cause` is the primary execution error. Execution failures with a successful destroy are rethrown unchanged. The new `CodeExecutionResult` and `CodeExecutionCleanupReport` types are exported and used by the wrapper descriptors.

### Patch Changes

- aa604d6: License metadata unified to MIT across every package, matching the repository LICENSE and README; each package now ships the LICENSE text in its tarball. The dead `packages/core/src/domains/` re-export barrel was removed (it was never exported or built).
- Updated dependencies [e1f022d]
- Updated dependencies [fc02fac]
- Updated dependencies [72d873a]
- Updated dependencies [fbae6f0]
- Updated dependencies [70cee7f]
- Updated dependencies [0f6ef03]
- Updated dependencies [42953dc]
- Updated dependencies [6488af5]
- Updated dependencies [45d50ee]
- Updated dependencies [a0d12be]
- Updated dependencies [1488e6a]
- Updated dependencies [fd7307a]
- Updated dependencies [e65957b]
- Updated dependencies [cf1ba2a]
- Updated dependencies [b14410b]
- Updated dependencies [f82ce34]
- Updated dependencies [aa604d6]
- Updated dependencies [78f0b9a]
- Updated dependencies [9c9340d]
- Updated dependencies [9ed60f4]
- Updated dependencies [2856feb]
- Updated dependencies [8a5abed]
- Updated dependencies [467b824]
- Updated dependencies [951af73]
- Updated dependencies [2dc1196]
- Updated dependencies [575c614]
- Updated dependencies [f78c06f]
- Updated dependencies [d561f4c]
  - @capsule-sdk/core@0.2.0

## 0.1.1

### Patch Changes

- 9f060c1: Restrict published package files and add release provenance hardening.
- f8848c0: Add explicit public npm publish configuration and Changesets release infrastructure.
- Updated dependencies [0501a7a]
- Updated dependencies [7967896]
- Updated dependencies [9f060c1]
- Updated dependencies [e1e89f1]
- Updated dependencies [f8848c0]
- Updated dependencies [68b5121]
- Updated dependencies [d3fe15c]
  - @capsule-sdk/core@0.1.1
