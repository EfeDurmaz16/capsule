# AI Framework Wrappers

`@capsule-sdk/ai` exposes a framework-agnostic Capsule code execution tool plus small descriptor helpers for common agent frameworks.

These helpers do not add framework dependencies. They return typed object shapes that can be passed into the framework-specific tool registration APIs in the application that already depends on that framework.

## Base Tool

```ts
import { Capsule } from "@capsule-sdk/core";
import { docker } from "@capsule-sdk/docker";
import { createCodeExecutionTool } from "@capsule-sdk/ai";

const capsule = new Capsule({
  adapter: docker(),
  policy: {
    network: { mode: "none" },
    limits: { timeoutMs: 60_000 }
  },
  receipts: true
});

const codeExecution = createCodeExecutionTool(capsule);
```

Each call creates a sandbox, writes the files, runs the command and destroys the sandbox. If the destroy fails, the tool throws `CleanupFailureError` instead of losing the execution outcome. `partialEffectsOf(error)` returns the record: `outcome` is `completed` with the `ExecResult` in `result`, or `failed`/`unknown` with the original error in `primaryError`; `cleanup.residual` holds the sandbox locator that may still exist. When execution fails but the destroy succeeds, the original execution error is rethrown unchanged. Do not retry a `completed` outcome as if the command never ran.

The base tool input is:

```ts
{
  language?: string;
  files: Array<{ path: string; content: string }>;
  command: string[] | string;
  timeoutMs?: number;
}
```

The result is Capsule's `ExecResult`: stdout, stderr, logs, artifacts, and optional receipt.

## Vercel AI SDK

```ts
import { tool } from "ai";
import { createVercelAiSdkTool } from "@capsule-sdk/ai";

const descriptor = createVercelAiSdkTool(codeExecution);

export const tools = {
  capsule_code_execution: tool({
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    execute: descriptor.execute
  })
};
```

## OpenAI Agents

```ts
import { createOpenAIAgentsTool } from "@capsule-sdk/ai";

const descriptor = createOpenAIAgentsTool(codeExecution);

const openAiTool = {
  name: descriptor.name,
  description: descriptor.description,
  parameters: descriptor.parameters,
  execute: descriptor.execute
};
```

## OpenAI Responses Function Tool

```ts
import { createOpenAIResponsesFunctionTool } from "@capsule-sdk/ai";

const descriptor = createOpenAIResponsesFunctionTool(codeExecution);

const responseToolDefinition = descriptor.tool;

async function handleFunctionCall(args: unknown) {
  return descriptor.execute(args as Parameters<typeof descriptor.execute>[0]);
}
```

The Responses tool sets `strict: true`, so its `parameters` are `codeExecutionInputStrictJsonSchema`, the generic schema normalized to the OpenAI strict function-calling rules: every property is listed in `required`, the optional `language` and `timeoutMs` accept `null`, and `command` uses `anyOf` over the same two branches instead of `oneOf`. `descriptor.execute` treats a `null` optional field as absent. The other wrappers keep `codeExecutionInputJsonSchema`. `toOpenAIStrictJsonSchema(schema)` applies the same normalization to your own schemas; it throws on keywords strict mode does not support (`allOf`, `not`, `if`/`then`/`else`, `dependentRequired`, `dependentSchemas`) and on any object that allows additional properties (`additionalProperties` other than `false` or absent), including a map with no `properties`, since strict mode cannot express it and closing it would drop every entry. Turning `oneOf` into `anyOf` keeps the accepted values only when the branches are disjoint.

## LangChain

```ts
import { createLangChainTool } from "@capsule-sdk/ai";

const descriptor = createLangChainTool(codeExecution);

const langChainTool = {
  name: descriptor.name,
  description: descriptor.description,
  schema: descriptor.schema,
  invoke: descriptor.invoke
};
```

## Mastra

```ts
import { createMastraTool } from "@capsule-sdk/ai";

const descriptor = createMastraTool(codeExecution);

const mastraTool = {
  id: descriptor.id,
  description: descriptor.description,
  inputSchema: descriptor.inputSchema,
  execute: descriptor.execute
};
```

## CrewAI

```ts
import { createCrewAiTool } from "@capsule-sdk/ai";

const descriptor = createCrewAiTool(codeExecution);

const crewAiTool = {
  name: descriptor.name,
  description: descriptor.description,
  schema: descriptor.schema,
  run: descriptor.run
};
```

## Security Boundary

The wrappers do not make execution safe by themselves. Safety still depends on the selected Capsule adapter, provider isolation, policy configuration, secret handling, and runtime account limits.

For untrusted code, do not rely on a local Docker daemon as the isolation boundary unless the host is explicitly hardened for that threat model. Use receipts as evidence of what Capsule observed, not proof of absolute sandbox containment.
