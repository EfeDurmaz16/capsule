---
"@capsule-sdk/ai": minor
---

`createOpenAIResponsesFunctionTool` now sends a schema that follows the OpenAI strict function-calling rules it declares with `strict: true`. Its `parameters` are the new `codeExecutionInputStrictJsonSchema`: every property is listed in `required`, the optional `language` and `timeoutMs` accept `null`, and `command` uses `anyOf` over the same two disjoint branches instead of `oneOf`, so it accepts the same values. `descriptor.execute` now accepts the strict arguments (`CodeExecutionStrictInput`) and passes a `null` optional field to the tool as absent. The generic `codeExecutionInputJsonSchema` and the other wrappers are unchanged. The new `toOpenAIStrictJsonSchema(schema)` normalizes a JSON Schema the same way and throws on keywords strict mode does not support.
