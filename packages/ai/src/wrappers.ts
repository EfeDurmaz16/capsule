import type { ExecResult } from "@capsule/core";
import type { CodeExecutionInput, CodeExecutionTool } from "./tool.js";

export type JsonSchema = Record<string, unknown>;

export const codeExecutionInputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["files", "command"],
  properties: {
    language: {
      type: "string",
      description: "Optional runtime language hint used to select the default sandbox image."
    },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "Absolute or sandbox-relative file path to write before execution."
          },
          content: {
            type: "string",
            description: "UTF-8 file content. Binary content should be handled by a custom wrapper."
          }
        }
      }
    },
    command: {
      oneOf: [
        { type: "string" },
        {
          type: "array",
          minItems: 1,
          items: { type: "string" }
        }
      ],
      description: "Command to execute in the sandbox."
    },
    timeoutMs: {
      type: "number",
      minimum: 1,
      description: "Optional execution timeout in milliseconds."
    }
  }
} as const satisfies JsonSchema;

export interface VercelAiSdkToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  inputSchema: typeof codeExecutionInputJsonSchema;
  execute(input: CodeExecutionInput): Promise<ExecResult>;
}

export interface OpenAIAgentsToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  parameters: typeof codeExecutionInputJsonSchema;
  execute(input: CodeExecutionInput): Promise<ExecResult>;
}

export interface OpenAIResponsesFunctionTool {
  type: "function";
  name: CodeExecutionTool["name"];
  description: string;
  parameters: typeof codeExecutionInputJsonSchema;
  strict: true;
}

export interface OpenAIResponsesToolDescriptor {
  tool: OpenAIResponsesFunctionTool;
  execute(input: CodeExecutionInput): Promise<ExecResult>;
}

export interface LangChainToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  schema: typeof codeExecutionInputJsonSchema;
  invoke(input: CodeExecutionInput): Promise<ExecResult>;
}

export interface MastraToolDescriptor {
  id: CodeExecutionTool["name"];
  description: string;
  inputSchema: typeof codeExecutionInputJsonSchema;
  execute(input: CodeExecutionInput): Promise<ExecResult>;
}

export interface CrewAiToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  schema: typeof codeExecutionInputJsonSchema;
  run(input: CodeExecutionInput): Promise<ExecResult>;
}

export function createVercelAiSdkTool(tool: CodeExecutionTool): VercelAiSdkToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: codeExecutionInputJsonSchema,
    execute: (input) => tool.execute(input)
  };
}

export function createOpenAIAgentsTool(tool: CodeExecutionTool): OpenAIAgentsToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    parameters: codeExecutionInputJsonSchema,
    execute: (input) => tool.execute(input)
  };
}

export function createOpenAIResponsesFunctionTool(tool: CodeExecutionTool): OpenAIResponsesToolDescriptor {
  return {
    tool: {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: codeExecutionInputJsonSchema,
      strict: true
    },
    execute: (input) => tool.execute(input)
  };
}

export function createLangChainTool(tool: CodeExecutionTool): LangChainToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    schema: codeExecutionInputJsonSchema,
    invoke: (input) => tool.execute(input)
  };
}

export function createMastraTool(tool: CodeExecutionTool): MastraToolDescriptor {
  return {
    id: tool.name,
    description: tool.description,
    inputSchema: codeExecutionInputJsonSchema,
    execute: (input) => tool.execute(input)
  };
}

export function createCrewAiTool(tool: CodeExecutionTool): CrewAiToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    schema: codeExecutionInputJsonSchema,
    run: (input) => tool.execute(input)
  };
}
