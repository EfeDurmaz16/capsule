import type { Capsule, ExecResult } from "@capsule/core";

export interface CodeExecutionFile {
  path: string;
  content: string | Uint8Array;
}

export interface CodeExecutionInput {
  language?: string;
  files: CodeExecutionFile[];
  command: string[] | string;
  timeoutMs?: number;
}

export interface CodeExecutionToolOptions {
  image?: string;
  cwd?: string;
}

export interface CodeExecutionTool {
  name: "capsule_code_execution";
  description: string;
  execute(input: CodeExecutionInput): Promise<ExecResult>;
}

function imageForLanguage(language: string | undefined, fallback: string | undefined): string {
  if (fallback) {
    return fallback;
  }
  switch (language) {
    case "python":
      return "python:3.12";
    case "typescript":
    case "javascript":
    default:
      return "node:22";
  }
}

export function createCodeExecutionTool(capsule: Capsule, options: CodeExecutionToolOptions = {}): CodeExecutionTool {
  return {
    name: "capsule_code_execution",
    description: "Execute code in a Capsule sandbox and return stdout, stderr, logs, artifacts, and an execution receipt.",
    async execute(input: CodeExecutionInput): Promise<ExecResult> {
      const sandbox = await capsule.sandbox.create({
        image: imageForLanguage(input.language, options.image),
        cwd: options.cwd,
        timeoutMs: input.timeoutMs
      });

      try {
        for (const file of input.files) {
          await sandbox.writeFile(file.path, file.content);
        }

        return await sandbox.exec({
          command: input.command,
          cwd: options.cwd,
          timeoutMs: input.timeoutMs
        });
      } finally {
        await sandbox.destroy();
      }
    }
  };
}

/*
Framework wrapping notes:

- Vercel AI SDK: wrap `execute` in `tool({ description, inputSchema, execute })`.
- OpenAI Agents: wrap `execute` with the Agents SDK `tool()` helper.
- OpenAI Responses: expose a function tool definition and route function_call arguments into `execute`.
- LangChain: wrap as a StructuredTool with the same input schema.
- Claude tools: expose as an MCP tool or in-process tool definition with approval gating around writes/execution.
- Mastra and CrewAI: register the same `execute` callback as a framework tool/action.

The package intentionally does not depend on any one AI framework.
*/
