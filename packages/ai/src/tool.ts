import {
  CleanupFailureError,
  resourceLocator,
  UnknownOutcomeError,
  type Capsule,
  type ExecResult,
  type PartialEffects,
  type ResourceLocator
} from "@capsule-sdk/core";

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

/**
 * Set on a completed result when the command ran to completion but the sandbox could not be destroyed
 * afterwards. The command must not be run again to "retry" the cleanup; only the sandbox teardown failed.
 */
export interface CodeExecutionCleanupReport {
  status: "failed";
  /** The sandbox that may still exist. */
  residual: ResourceLocator[];
  /** Message of the teardown failure. */
  error: string;
}

export interface CodeExecutionResult extends ExecResult {
  cleanup?: CodeExecutionCleanupReport;
}

export interface CodeExecutionTool {
  name: "capsule_code_execution";
  description: string;
  execute(input: CodeExecutionInput): Promise<CodeExecutionResult>;
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

// Thrown only when execution itself failed and teardown failed too. A completed execution is returned
// with a cleanup report instead (see execute below).
function cleanupFailure(
  handle: { id: string; provider: string },
  primaryError: unknown,
  cleanupError: unknown
): CleanupFailureError<CodeExecutionCleanupFailure> {
  const sandbox = resourceLocator({ provider: handle.provider, kind: "sandbox", nativeId: handle.id });
  const effects: PartialEffects<ExecResult> = {
    operation: "sandbox.exec",
    outcome: primaryError instanceof UnknownOutcomeError ? "unknown" : "failed",
    resources: [sandbox],
    primaryError,
    cleanup: { status: "failed", resources: [sandbox], residual: [sandbox], error: cleanupError }
  };
  return new CleanupFailureError<CodeExecutionCleanupFailure>(
    "Code execution failed and the sandbox could not be destroyed; the sandbox may still exist.",
    { sandbox: { id: handle.id, provider: handle.provider }, error: cleanupError },
    primaryError,
    effects
  );
}

export function createCodeExecutionTool(capsule: Capsule, options: CodeExecutionToolOptions = {}): CodeExecutionTool {
  return {
    name: "capsule_code_execution",
    description: "Execute code in a Capsule sandbox and return stdout, stderr, logs, artifacts, and an execution receipt.",
    async execute(input: CodeExecutionInput): Promise<CodeExecutionResult> {
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
        // Keep the primary outcome and the cleanup failure separate. A primary failure is not masked.
        // A completed execution is returned, not thrown: every framework wrapper turns a throw into a
        // tool error, which invites the model to run a non-idempotent command a second time. The result
        // says the sandbox may still exist instead.
        if (!primaryFailed) {
          const residual = [resourceLocator({ provider: sandbox.handle.provider, kind: "sandbox", nativeId: sandbox.handle.id })];
          return {
            ...(result as ExecResult),
            cleanup: { status: "failed", residual, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }
          };
        }
        throw cleanupFailure(sandbox.handle, primaryError, cleanupError);
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
