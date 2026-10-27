import type { CodeExecutionInput, CodeExecutionResult, CodeExecutionTool } from "./tool.js";

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

/**
 * `codeExecutionInputJsonSchema` normalized for OpenAI strict function calling (`strict: true`), used by
 * `createOpenAIResponsesFunctionTool`. Strict mode requires every property in `required` and emulates an
 * optional property with a union that includes `null`; its supported union keyword is `anyOf`, not `oneOf`.
 * `language` and `timeoutMs` therefore accept `null`, and `command` uses `anyOf` over the same two disjoint
 * branches, so it accepts exactly the same values as before.
 */
export const codeExecutionInputStrictJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["language", "files", "command", "timeoutMs"],
  properties: {
    language: {
      type: ["string", "null"],
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
      anyOf: [
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
      type: ["number", "null"],
      minimum: 1,
      description: "Optional execution timeout in milliseconds."
    }
  }
} as const satisfies JsonSchema;

/** Arguments a strict function call delivers: optional fields arrive as `null` when the model omits them. */
export interface CodeExecutionStrictInput extends Omit<CodeExecutionInput, "language" | "timeoutMs"> {
  language?: string | null;
  timeoutMs?: number | null;
}

const unsupportedStrictKeywords = ["allOf", "not", "if", "then", "else", "dependentRequired", "dependentSchemas"];

/**
 * Normalizes a JSON Schema to the OpenAI strict function-calling subset: every object lists all of its
 * properties in `required` and sets `additionalProperties: false`, properties that were optional become
 * nullable, and `oneOf` becomes `anyOf`. `oneOf` to `anyOf` keeps the accepted values only when the
 * branches are disjoint, as they are in Capsule's schemas. Keywords strict mode does not support throw.
 */
export function toOpenAIStrictJsonSchema(schema: JsonSchema): JsonSchema {
  return normalizeStrict(schema, "#");
}

function normalizeStrict(schema: JsonSchema, at: string): JsonSchema {
  for (const keyword of unsupportedStrictKeywords) {
    if (keyword in schema) throw new Error(`OpenAI strict mode does not support ${keyword} (at ${at}).`);
  }
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "oneOf" || key === "anyOf") {
      out.anyOf = (value as JsonSchema[]).map((branch, index) => normalizeStrict(branch, `${at}/${key}/${index}`));
    } else if (key === "items" && isSchema(value)) {
      out.items = normalizeStrict(value, `${at}/items`);
    } else if ((key === "$defs" || key === "definitions") && isSchema(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, normalizeStrict(child as JsonSchema, `${at}/${key}/${name}`)]));
    } else if (key !== "properties" && key !== "required" && key !== "additionalProperties") {
      out[key] = value;
    }
  }
  if (isSchema(schema.properties)) {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      throw new Error(`OpenAI strict mode requires additionalProperties: false (at ${at}).`);
    }
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const properties: JsonSchema = {};
    for (const [name, child] of Object.entries(schema.properties)) {
      const normalized = normalizeStrict(child as JsonSchema, `${at}/properties/${name}`);
      properties[name] = required.has(name) ? normalized : nullable(normalized);
    }
    out.additionalProperties = false;
    out.required = Object.keys(properties);
    out.properties = properties;
  } else if (schema.type === "object") {
    out.additionalProperties = false;
    out.required = [];
    out.properties = {};
  }
  return out;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((branch) => isSchema(branch) && branch.type === "null") ? schema : { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  }
  if (typeof schema.type === "string" || Array.isArray(schema.type)) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type];
    const withNull: JsonSchema = { ...schema, type: types.includes("null") ? types : [...types, "null"] };
    if (Array.isArray(schema.enum) && !schema.enum.includes(null)) withNull.enum = [...schema.enum, null];
    return withNull;
  }
  const { description, ...rest } = schema;
  return { anyOf: [rest, { type: "null" }], ...(description === undefined ? {} : { description }) };
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Strict mode sends null for an omitted optional field; the tool itself takes an absent field.
function fromStrictInput(input: CodeExecutionInput | CodeExecutionStrictInput): CodeExecutionInput {
  const { language, timeoutMs, ...rest } = input;
  return {
    ...rest,
    ...(language === null || language === undefined ? {} : { language }),
    ...(timeoutMs === null || timeoutMs === undefined ? {} : { timeoutMs })
  };
}

export interface VercelAiSdkToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  inputSchema: typeof codeExecutionInputJsonSchema;
  execute(input: CodeExecutionInput): Promise<CodeExecutionResult>;
}

export interface OpenAIAgentsToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  parameters: typeof codeExecutionInputJsonSchema;
  execute(input: CodeExecutionInput): Promise<CodeExecutionResult>;
}

export interface OpenAIResponsesFunctionTool {
  type: "function";
  name: CodeExecutionTool["name"];
  description: string;
  parameters: typeof codeExecutionInputStrictJsonSchema;
  strict: true;
}

export interface OpenAIResponsesToolDescriptor {
  tool: OpenAIResponsesFunctionTool;
  /** Accepts the strict-mode arguments as delivered (optional fields may be null) or a plain input. */
  execute(input: CodeExecutionInput | CodeExecutionStrictInput): Promise<CodeExecutionResult>;
}

export interface LangChainToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  schema: typeof codeExecutionInputJsonSchema;
  invoke(input: CodeExecutionInput): Promise<CodeExecutionResult>;
}

export interface MastraToolDescriptor {
  id: CodeExecutionTool["name"];
  description: string;
  inputSchema: typeof codeExecutionInputJsonSchema;
  execute(input: CodeExecutionInput): Promise<CodeExecutionResult>;
}

export interface CrewAiToolDescriptor {
  name: CodeExecutionTool["name"];
  description: string;
  schema: typeof codeExecutionInputJsonSchema;
  run(input: CodeExecutionInput): Promise<CodeExecutionResult>;
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
      parameters: codeExecutionInputStrictJsonSchema,
      strict: true
    },
    execute: (input) => tool.execute(fromStrictInput(input))
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
