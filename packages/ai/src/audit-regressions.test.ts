// Audit regressions for the M1 campaign (AI tool wrapper). Each test asserts the INTENDED behavior from
// the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The Capsule is an in-memory fake.
import { describe, expect, it } from "vitest";
import { CleanupFailureError, partialEffectsOf, type Capsule } from "@capsule-sdk/core";
import { createCodeExecutionTool } from "./tool.js";
import {
  codeExecutionInputJsonSchema,
  codeExecutionInputStrictJsonSchema,
  createLangChainTool,
  createOpenAIResponsesFunctionTool,
  createVercelAiSdkTool,
  toOpenAIStrictJsonSchema
} from "./wrappers.js";

function errorText(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || value === undefined || seen.has(value)) return "";
  if (typeof value !== "object") return String(value);
  seen.add(value);
  const parts: string[] = [];
  if (value instanceof Error) parts.push(value.message, errorText((value as { cause?: unknown }).cause, seen));
  for (const child of Object.values(value)) parts.push(errorText(child, seen));
  return parts.join(" ");
}

function fakeCapsule(exec: () => Promise<unknown>): Capsule {
  return {
    sandbox: {
      create: async () => ({
        handle: { id: "audit-box", provider: "fake", createdAt: new Date(0).toISOString() },
        writeFile: async () => {},
        exec,
        destroy: async () => {
          throw new Error("cleanup failure");
        }
      })
    }
  } as never;
}

describe("M1 audit regressions: ai tool", () => {
  it("COMP-03: exec failure plus destroy failure retains both outcomes", async () => {
    const tool = createCodeExecutionTool(
      fakeCapsule(async () => {
        throw new Error("primary execution failure");
      })
    );
    const error = await tool.execute({ files: [], command: "x" }).then(
      () => undefined,
      (caught: unknown) => caught
    );
    const text = errorText(error);
    expect(text).toContain("primary execution failure");
    expect(text).toContain("cleanup failure");
  });

  it("COMP-03: exec success plus destroy failure resolves with the completed result and the cleanup failure", async () => {
    let runs = 0;
    const tool = createCodeExecutionTool(
      fakeCapsule(async () => {
        runs += 1;
        return { exitCode: 0, stdout: "completed-output", stderr: "", logs: [], artifacts: [] };
      })
    );
    // A throw here would reach every framework wrapper as a tool error and invite a second execution of
    // a possibly non-idempotent command, so the completed result must be returned, not thrown.
    for (const execute of [tool.execute, createVercelAiSdkTool(tool).execute, createLangChainTool(tool).invoke]) {
      const result = await execute({ files: [], command: "x" });
      expect(result.stdout).toBe("completed-output");
      expect(result.exitCode).toBe(0);
      expect(result.cleanup).toEqual({
        status: "failed",
        residual: [{ provider: "fake", kind: "sandbox", nativeId: "audit-box" }],
        error: "cleanup failure"
      });
    }
    expect(runs).toBe(3);
  });

  it("COMP-03: the structured record separates primary and cleanup outcomes with the sandbox locator", async () => {
    const failing = await createCodeExecutionTool(
      fakeCapsule(async () => {
        throw new Error("primary execution failure");
      })
    )
      .execute({ files: [], command: "x" })
      .catch((caught: unknown) => caught);
    expect(failing).toBeInstanceOf(CleanupFailureError);
    expect((failing as Error).cause).toMatchObject({ message: "primary execution failure" });
    expect(partialEffectsOf(failing)).toMatchObject({
      operation: "sandbox.exec",
      outcome: "failed",
      resources: [{ provider: "fake", kind: "sandbox", nativeId: "audit-box" }],
      primaryError: { message: "primary execution failure" },
      cleanup: { status: "failed", residual: [{ nativeId: "audit-box" }], error: { message: "cleanup failure" } }
    });
  });
});

// GAP-20: the OpenAI strict function-calling rules were reverified on 27 Oct 2026 against the official
// docs (developers.openai.com/api/docs/guides/function-calling, "Strict mode", and
// developers.openai.com/api/docs/guides/structured-outputs, "Supported schemas"): additionalProperties must
// be false on every object, every property must be listed in required, an optional field is emulated with a
// union that includes null, anyOf is the supported union keyword (oneOf is not listed), and allOf, not,
// dependentRequired, dependentSchemas, if, then and else are not supported. No model is called here.
type SchemaNode = Record<string, unknown>;

function strictViolations(node: unknown, at = "#"): string[] {
  if (typeof node !== "object" || node === null) return [];
  if (Array.isArray(node)) return node.flatMap((child, index) => strictViolations(child, `${at}/${index}`));
  const schema = node as SchemaNode;
  const problems: string[] = [];
  for (const keyword of ["oneOf", "allOf", "not", "if", "then", "else", "dependentRequired", "dependentSchemas"]) {
    if (keyword in schema) problems.push(`${at}: ${keyword}`);
  }
  if (schema.type === "object" || "properties" in schema) {
    if (schema.additionalProperties !== false) problems.push(`${at}: additionalProperties is not false`);
    const keys = Object.keys((schema.properties as SchemaNode | undefined) ?? {}).sort();
    const required = [...((schema.required as string[] | undefined) ?? [])].sort();
    if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${at}: required ${JSON.stringify(required)} != properties ${JSON.stringify(keys)}`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      for (const [name, child] of Object.entries(value as SchemaNode)) problems.push(...strictViolations(child, `${at}/properties/${name}`));
    } else if (key === "items" || key === "anyOf" || key === "$defs") {
      problems.push(...strictViolations(value, `${at}/${key}`));
    }
  }
  return problems;
}

function acceptsNull(schema: SchemaNode): boolean {
  if (Array.isArray(schema.type)) return schema.type.includes("null");
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((branch) => (branch as SchemaNode).type === "null");
  return schema.type === "null";
}

describe("GAP-20: the strict Responses tool schema follows the official strict-mode rules", () => {
  it("emits a strict-valid schema: all properties required, optional ones nullable, anyOf instead of oneOf", () => {
    const { tool } = createOpenAIResponsesFunctionTool({ name: "capsule_code_execution", description: "Run code", execute: async () => ({}) as never });
    expect(tool.strict).toBe(true);
    expect(strictViolations(tool.parameters)).toEqual([]);
    expect(tool.parameters.type).toBe("object");
    expect("anyOf" in tool.parameters).toBe(false);
    const optional = Object.keys(codeExecutionInputJsonSchema.properties).filter(
      (name) => !(codeExecutionInputJsonSchema.required as readonly string[]).includes(name)
    );
    expect(optional).toEqual(["language", "timeoutMs"]);
    for (const name of optional) expect(acceptsNull((tool.parameters.properties as SchemaNode)[name] as SchemaNode)).toBe(true);
    for (const name of codeExecutionInputJsonSchema.required) expect(acceptsNull((tool.parameters.properties as SchemaNode)[name] as SchemaNode)).toBe(false);
  });

  it("derives the strict schema from the generic schema and leaves the generic schema unchanged", () => {
    const before = JSON.stringify(codeExecutionInputJsonSchema);
    expect(toOpenAIStrictJsonSchema(codeExecutionInputJsonSchema)).toEqual(codeExecutionInputStrictJsonSchema);
    expect(JSON.stringify(codeExecutionInputJsonSchema)).toBe(before);
    expect(strictViolations(codeExecutionInputJsonSchema)).not.toEqual([]);
  });

  it("passes omitted optional fields to the tool as absent, not null", async () => {
    const seen: unknown[] = [];
    const descriptor = createOpenAIResponsesFunctionTool({
      name: "capsule_code_execution",
      description: "Run code",
      execute: async (input) => {
        seen.push(input);
        return {} as never;
      }
    });
    await descriptor.execute({ language: null, files: [{ path: "a.js", content: "1" }], command: ["node", "a.js"], timeoutMs: null });
    await descriptor.execute({ language: "python", files: [], command: "true", timeoutMs: 5 });
    expect(seen[0]).toEqual({ files: [{ path: "a.js", content: "1" }], command: ["node", "a.js"] });
    expect(seen[0]).not.toHaveProperty("language");
    expect(seen[0]).not.toHaveProperty("timeoutMs");
    expect(seen[1]).toEqual({ language: "python", files: [], command: "true", timeoutMs: 5 });
  });

  it("normalizes nested objects, enums and untyped optionals and rejects keywords strict mode lacks", () => {
    expect(
      toOpenAIStrictJsonSchema({
        type: "object",
        properties: {
          mode: { type: "string", enum: ["a", "b"] },
          ref: { $ref: "#/$defs/step", description: "d" },
          nested: { type: "object", properties: { x: { type: "integer" } } }
        },
        $defs: { step: { type: "object", properties: { y: { oneOf: [{ type: "string" }, { type: "number" }] } }, required: ["y"] } }
      })
    ).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["mode", "ref", "nested"],
      properties: {
        mode: { type: ["string", "null"], enum: ["a", "b", null] },
        ref: { anyOf: [{ $ref: "#/$defs/step" }, { type: "null" }], description: "d" },
        nested: { type: ["object", "null"], additionalProperties: false, required: ["x"], properties: { x: { type: ["integer", "null"] } } }
      },
      $defs: {
        step: { type: "object", additionalProperties: false, required: ["y"], properties: { y: { anyOf: [{ type: "string" }, { type: "number" }] } } }
      }
    });
    expect(() => toOpenAIStrictJsonSchema({ type: "object", properties: { a: { allOf: [] } } })).toThrow("does not support allOf");
    expect(() => toOpenAIStrictJsonSchema({ type: "object", additionalProperties: true, properties: {} })).toThrow("additionalProperties: false");
  });

  it("throws on an open or map object without properties instead of closing it to an empty object", () => {
    // A map such as env: { [name]: string } has no strict-mode form. Rewriting it to a closed object with
    // no properties let the model send only {}, silently dropping every entry.
    const map = { type: "object", properties: { env: { type: "object", additionalProperties: { type: "string" } } }, required: ["env"] };
    expect(() => toOpenAIStrictJsonSchema(map)).toThrow("additionalProperties: false (at #/properties/env)");
    expect(() => toOpenAIStrictJsonSchema({ type: "object", additionalProperties: true })).toThrow("additionalProperties: false (at #)");
    expect(() => toOpenAIStrictJsonSchema({ type: ["object", "null"], additionalProperties: {} })).toThrow("additionalProperties: false (at #)");
    expect(toOpenAIStrictJsonSchema({ type: "object" })).toEqual({ type: "object", additionalProperties: false, required: [], properties: {} });
    expect(toOpenAIStrictJsonSchema({ type: "object", additionalProperties: false })).toEqual({
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {}
    });
  });
});
