# AI Framework Wrappers

`@capsule/ai` exposes a framework-agnostic Capsule code execution tool plus small descriptor helpers for common agent frameworks.

These helpers do not add framework dependencies. They return typed object shapes that can be passed into the framework-specific tool registration APIs in the application that already depends on that framework.

## Base Tool

```ts
import { Capsule } from "@capsule/core";
import { docker } from "@capsule/adapter-docker";
import { createCodeExecutionTool } from "@capsule/ai";

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
import { createVercelAiSdkTool } from "@capsule/ai";

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
import { createOpenAIAgentsTool } from "@capsule/ai";

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
import { createOpenAIResponsesFunctionTool } from "@capsule/ai";

const descriptor = createOpenAIResponsesFunctionTool(codeExecution);

const responseToolDefinition = descriptor.tool;

async function handleFunctionCall(args: unknown) {
  return descriptor.execute(args as Parameters<typeof descriptor.execute>[0]);
}
```

## LangChain

```ts
import { createLangChainTool } from "@capsule/ai";

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
import { createMastraTool } from "@capsule/ai";

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
import { createCrewAiTool } from "@capsule/ai";

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
