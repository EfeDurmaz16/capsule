import { describe, expect, test, vi } from "vitest";
import type { Capsule, CapsuleReceipt, CreateSandboxSpec, ExecResult, ExecSpec, Sandbox } from "@capsule-sdk/core";
import { createCodeExecutionTool } from "./tool.js";

function okResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    logs: [],
    artifacts: [],
    ...overrides
  };
}

interface FakeSandboxOptions {
  execImpl?: (spec: ExecSpec) => Promise<ExecResult>;
}

function fakeSandbox(options: FakeSandboxOptions = {}) {
  const writeFile = vi.fn(async (_path: string, _data: string | Uint8Array) => {});
  const exec = vi.fn(options.execImpl ?? (async () => okResult()));
  const destroy = vi.fn(async () => {});
  const sandbox = {
    handle: { id: "sbx-1", provider: "mock", createdAt: "2026-07-17T00:00:00.000Z" },
    exec,
    writeFile,
    readFile: vi.fn(async () => new Uint8Array()),
    listFiles: vi.fn(async () => []),
    destroy
  } as unknown as Sandbox;
  return { sandbox, writeFile, exec, destroy };
}

interface FakeCapsuleOptions {
  createImpl?: (spec: CreateSandboxSpec) => Promise<Sandbox>;
  sandbox?: ReturnType<typeof fakeSandbox>;
}

function fakeCapsule(options: FakeCapsuleOptions = {}) {
  const sandbox = options.sandbox ?? fakeSandbox();
  const create = vi.fn(options.createImpl ?? (async () => sandbox.sandbox));
  const capsule = { sandbox: { create } } as unknown as Capsule;
  return { capsule, create, ...sandbox };
}

describe("createCodeExecutionTool", () => {
  test("pins the tool name and description", () => {
    const tool = createCodeExecutionTool(fakeCapsule().capsule);
    expect(tool.name).toBe("capsule_code_execution");
    expect(tool.description).toBe("Execute code in a Capsule sandbox and return stdout, stderr, logs, artifacts, and an execution receipt.");
  });

  test("writes every file then execs the command and returns the sandbox result", async () => {
    const { capsule, create, writeFile, exec, destroy } = fakeCapsule();
    const tool = createCodeExecutionTool(capsule);

    const result = await tool.execute({
      files: [
        { path: "main.py", content: "print(1)" },
        { path: "data.bin", content: new Uint8Array([1, 2, 3]) }
      ],
      command: ["python", "main.py"]
    });

    expect(result).toEqual(okResult());
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenNthCalledWith(1, "main.py", "print(1)");
    expect(writeFile).toHaveBeenNthCalledWith(2, "data.bin", new Uint8Array([1, 2, 3]));
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toMatchObject({ command: ["python", "main.py"] });
    expect(create).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();

    // files are written before the command runs
    expect(writeFile.mock.invocationCallOrder[1]).toBeLessThan(exec.mock.invocationCallOrder[0]);
  });

  test("selects the python image for the python language hint", async () => {
    const { capsule, create } = fakeCapsule();
    await createCodeExecutionTool(capsule).execute({ language: "python", files: [], command: "python -V" });
    expect(create.mock.calls[0][0]).toMatchObject({ image: "python:3.12" });
  });

  test.each(["typescript", "javascript", undefined])("defaults to node:22 for %s", async (language) => {
    const { capsule, create } = fakeCapsule();
    await createCodeExecutionTool(capsule).execute({ language, files: [], command: "node -e 1" });
    expect(create.mock.calls[0][0]).toMatchObject({ image: "node:22" });
  });

  test("an explicit image option overrides the language-derived image", async () => {
    const { capsule, create } = fakeCapsule();
    await createCodeExecutionTool(capsule, { image: "custom:latest" }).execute({ language: "python", files: [], command: "python -V" });
    expect(create.mock.calls[0][0]).toMatchObject({ image: "custom:latest" });
  });

  test("threads cwd into both sandbox creation and exec, and timeoutMs into both", async () => {
    const { capsule, create, exec } = fakeCapsule();
    await createCodeExecutionTool(capsule, { cwd: "/work" }).execute({ files: [], command: "ls", timeoutMs: 5000 });
    expect(create.mock.calls[0][0]).toMatchObject({ cwd: "/work", timeoutMs: 5000 });
    expect(exec.mock.calls[0][0]).toMatchObject({ cwd: "/work", timeoutMs: 5000 });
  });

  test("surfaces the execution receipt in the returned result", async () => {
    const receipt = { id: "rcpt-1" } as unknown as CapsuleReceipt;
    const sandbox = fakeSandbox({ execImpl: async () => okResult({ receipt }) });
    const { capsule } = fakeCapsule({ sandbox });
    const result = await createCodeExecutionTool(capsule).execute({ files: [], command: "true" });
    expect(result.receipt).toBe(receipt);
  });

  test("surfaces non-zero exit codes without throwing", async () => {
    const sandbox = fakeSandbox({ execImpl: async () => okResult({ exitCode: 1, stderr: "boom" }) });
    const { capsule } = fakeCapsule({ sandbox });
    const result = await createCodeExecutionTool(capsule).execute({ files: [], command: "false" });
    expect(result).toMatchObject({ exitCode: 1, stderr: "boom" });
  });

  test("propagates exec errors and still destroys the sandbox", async () => {
    const sandbox = fakeSandbox({
      execImpl: async () => {
        throw new Error("exec failed");
      }
    });
    const { capsule, destroy } = fakeCapsule({ sandbox });
    await expect(createCodeExecutionTool(capsule).execute({ files: [], command: "boom" })).rejects.toThrow("exec failed");
    expect(destroy).toHaveBeenCalledOnce();
  });

  test("propagates policy denial or timeout from sandbox creation without touching a sandbox", async () => {
    const { capsule, create, exec, destroy } = fakeCapsule({
      createImpl: async () => {
        throw new Error("policy: sandbox.create denied");
      }
    });
    await expect(createCodeExecutionTool(capsule).execute({ files: [], command: "ls" })).rejects.toThrow("sandbox.create denied");
    expect(create).toHaveBeenCalledOnce();
    // creation failed, so nothing should have run or been torn down
    expect(exec).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});
