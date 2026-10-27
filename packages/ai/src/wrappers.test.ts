import { describe, expect, test, vi } from "vitest";
import type { CodeExecutionTool } from "./tool.js";
import {
  codeExecutionInputJsonSchema,
  codeExecutionInputStrictJsonSchema,
  createCrewAiTool,
  createLangChainTool,
  createMastraTool,
  createOpenAIAgentsTool,
  createOpenAIResponsesFunctionTool,
  createVercelAiSdkTool
} from "./wrappers.js";

const result = {
  exitCode: 0,
  stdout: "ok",
  stderr: "",
  logs: [],
  artifacts: []
};

function fakeTool(): CodeExecutionTool {
  return {
    name: "capsule_code_execution",
    description: "Run code",
    execute: vi.fn(async () => result)
  };
}

describe("AI framework wrapper descriptors", () => {
  test("exports a JSON-schema compatible code execution input schema", () => {
    expect(codeExecutionInputJsonSchema).toMatchObject({
      type: "object",
      required: ["files", "command"],
      properties: {
        files: expect.objectContaining({ type: "array" }),
        command: expect.objectContaining({ oneOf: expect.any(Array) })
      }
    });
  });

  test("creates a Vercel AI SDK style descriptor without framework dependency", async () => {
    const tool = fakeTool();
    const descriptor = createVercelAiSdkTool(tool);

    await expect(descriptor.execute({ files: [], command: "node -e 1" })).resolves.toBe(result);
    expect(descriptor).toMatchObject({
      name: "capsule_code_execution",
      description: "Run code",
      inputSchema: codeExecutionInputJsonSchema
    });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  test("creates OpenAI Agents and Responses descriptors", async () => {
    const tool = fakeTool();
    const agents = createOpenAIAgentsTool(tool);
    const responses = createOpenAIResponsesFunctionTool(tool);

    expect(agents.parameters).toBe(codeExecutionInputJsonSchema);
    expect(responses.tool).toMatchObject({
      type: "function",
      name: "capsule_code_execution",
      parameters: codeExecutionInputStrictJsonSchema,
      strict: true
    });

    await responses.execute({ files: [], command: ["node", "-e", "1"] });
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  test("creates LangChain, Mastra, and CrewAI descriptors", async () => {
    const tool = fakeTool();

    await expect(createLangChainTool(tool).invoke({ files: [], command: "node -e 1" })).resolves.toBe(result);
    await expect(createMastraTool(tool).execute({ files: [], command: "node -e 2" })).resolves.toBe(result);
    await expect(createCrewAiTool(tool).run({ files: [], command: "node -e 3" })).resolves.toBe(result);

    expect(tool.execute).toHaveBeenCalledTimes(3);
  });

  test("pins the full JSON schema shape so framework contracts cannot drift", () => {
    expect(codeExecutionInputJsonSchema).toEqual({
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
          oneOf: [{ type: "string" }, { type: "array", minItems: 1, items: { type: "string" } }],
          description: "Command to execute in the sandbox."
        },
        timeoutMs: {
          type: "number",
          minimum: 1,
          description: "Optional execution timeout in milliseconds."
        }
      }
    });
  });

  test("pins each descriptor's exact key names, schema slot, and metadata", () => {
    const tool = fakeTool();

    // Every framework carries the schema under a different key; the same singleton must land in each slot.
    expect(Object.keys(createVercelAiSdkTool(tool)).sort()).toEqual(["description", "execute", "inputSchema", "name"]);
    expect(createVercelAiSdkTool(tool).inputSchema).toBe(codeExecutionInputJsonSchema);

    expect(Object.keys(createOpenAIAgentsTool(tool)).sort()).toEqual(["description", "execute", "name", "parameters"]);
    expect(createOpenAIAgentsTool(tool).parameters).toBe(codeExecutionInputJsonSchema);

    const responses = createOpenAIResponsesFunctionTool(tool);
    expect(Object.keys(responses).sort()).toEqual(["execute", "tool"]);
    expect(Object.keys(responses.tool).sort()).toEqual(["description", "name", "parameters", "strict", "type"]);
    expect(responses.tool.type).toBe("function");
    expect(responses.tool.strict).toBe(true);
    expect(responses.tool.parameters).toBe(codeExecutionInputStrictJsonSchema);

    expect(Object.keys(createLangChainTool(tool)).sort()).toEqual(["description", "invoke", "name", "schema"]);
    expect(createLangChainTool(tool).schema).toBe(codeExecutionInputJsonSchema);

    const mastra = createMastraTool(tool);
    expect(Object.keys(mastra).sort()).toEqual(["description", "execute", "id", "inputSchema"]);
    expect(mastra.id).toBe("capsule_code_execution");
    expect(mastra.inputSchema).toBe(codeExecutionInputJsonSchema);

    expect(Object.keys(createCrewAiTool(tool)).sort()).toEqual(["description", "name", "run", "schema"]);
    expect(createCrewAiTool(tool).schema).toBe(codeExecutionInputJsonSchema);
  });

  test("every descriptor forwards the tool name and description verbatim", () => {
    const tool = fakeTool();
    const named = [createVercelAiSdkTool(tool), createOpenAIAgentsTool(tool), createLangChainTool(tool), createCrewAiTool(tool)];
    for (const descriptor of named) {
      expect(descriptor.name).toBe("capsule_code_execution");
      expect(descriptor.description).toBe("Run code");
    }
    expect(createMastraTool(tool).id).toBe("capsule_code_execution");
    expect(createOpenAIResponsesFunctionTool(tool).tool.name).toBe("capsule_code_execution");
  });
});
