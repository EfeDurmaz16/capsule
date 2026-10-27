import { CleanupFailureError, resourceLocator, UnknownOutcomeError, type Capsule, type ExecResult, type PartialEffects } from "@capsule-sdk/core";

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

/** Cleanup detail carried by the CleanupFailureError thrown when sandbox teardown fails. */
export interface CodeExecutionCleanupFailure {
  sandbox: { id: string; provider: string };
  error: unknown;
}

function cleanupFailure(
  handle: { id: string; provider: string },
  primaryFailed: boolean,
  primaryError: unknown,
  result: ExecResult | undefined,
  cleanupError: unknown
): CleanupFailureError<CodeExecutionCleanupFailure> {
  const sandbox = resourceLocator({ provider: handle.provider, kind: "sandbox", nativeId: handle.id });
  const effects: PartialEffects<ExecResult> = {
    operation: "sandbox.exec",
    outcome: primaryFailed ? (primaryError instanceof UnknownOutcomeError ? "unknown" : "failed") : "completed",
    resources: [sandbox],
    ...(primaryFailed ? { primaryError } : { result }),
    cleanup: { status: "failed", resources: [sandbox], residual: [sandbox], error: cleanupError }
  };
  const message = primaryFailed
    ? "Code execution failed and the sandbox could not be destroyed; the sandbox may still exist."
    : "Code execution completed but the sandbox could not be destroyed; the sandbox may still exist.";
  return new CleanupFailureError<CodeExecutionCleanupFailure>(
    message,
    { sandbox: { id: handle.id, provider: handle.provider }, error: cleanupError },
    primaryFailed ? primaryError : cleanupError,
    effects
  );
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

      let result: ExecResult | undefined;
      let primaryFailed = false;
      let primaryError: unknown;
      try {
        for (const file of input.files) {
          await sandbox.writeFile(file.path, file.content);
        }

        result = await sandbox.exec({
          command: input.command,
          cwd: options.cwd,
          timeoutMs: input.timeoutMs
        });
      } catch (error) {
        primaryFailed = true;
        primaryError = error;
      }

      try {
        await sandbox.destroy();
      } catch (cleanupError) {
        // Keep the primary outcome and the cleanup failure separate. A completed result is not thrown
        // away, and a primary failure is not masked, so a caller can tell whether execution happened.
        throw cleanupFailure(sandbox.handle, primaryFailed, primaryError, result, cleanupError);
      }

      if (primaryFailed) {
        throw primaryError;
      }
      return result as ExecResult;
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
