import { describe, expect, test, vi } from "vitest";
import type { CodeExecutionTool } from "./tool.js";
import {
  codeExecutionInputJsonSchema,
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
      parameters: codeExecutionInputJsonSchema,
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
});
