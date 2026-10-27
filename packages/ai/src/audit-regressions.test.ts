// Audit regressions for the M1 campaign (AI tool wrapper). Each test asserts the INTENDED behavior from
// the M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The Capsule is an in-memory fake.
import { describe, expect, it } from "vitest";
import { CleanupFailureError, partialEffectsOf, type Capsule, type ExecResult } from "@capsule-sdk/core";
import { createCodeExecutionTool } from "./tool.js";

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

  it("COMP-03: exec success plus destroy failure retains the completed result and the cleanup failure", async () => {
    const tool = createCodeExecutionTool(fakeCapsule(async () => ({ exitCode: 0, stdout: "completed-output", stderr: "", logs: [], artifacts: [] })));
    const outcome = await tool.execute({ files: [], command: "x" }).then(
      (value: unknown) => value,
      (caught: unknown) => caught
    );
    const text = errorText(outcome);
    expect(text).toContain("completed-output");
    expect(text).toContain("cleanup failure");
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

    const completed = await createCodeExecutionTool(fakeCapsule(async () => ({ exitCode: 0, stdout: "completed-output", stderr: "", logs: [], artifacts: [] })))
      .execute({ files: [], command: "x" })
      .catch((caught: unknown) => caught);
    expect(partialEffectsOf(completed)).toMatchObject({ outcome: "completed", cleanup: { status: "failed" } });
    expect((partialEffectsOf(completed)?.result as ExecResult).stdout).toBe("completed-output");
  });
});

describe("deferred M1 items (visible skips with reason and dependency)", () => {
  // GAP-20 deferred: createOpenAIResponsesFunctionTool sets strict: true on a schema with optional
  // properties outside `required` and a `oneOf`. Whether the Responses API rejects it is a pending candidate:
  // the current official OpenAI strict function-calling rules were not reverified in M1. Dependency: reverify
  // the official docs, then isolate a strict-normalized schema (nullable optionals listed in required,
  // anyOf instead of oneOf) in packages/ai with offline tests. No external model call is needed.
  it.skip("GAP-20 (deferred): the strict Responses tool schema follows the official strict-mode rules", () => {
    // Intended assertion: every property is listed in `required`, optional ones are nullable, and no `oneOf`
    // appears in the strict schema, while the generic schema stays unchanged.
  });
});
