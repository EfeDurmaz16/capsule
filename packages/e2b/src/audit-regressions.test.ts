// Audit regressions for the M1 campaign (E2B sandbox). Each test asserts the INTENDED behavior from the
// M1 manifest and is marked it.fails while the defect is present on the baseline (7d3a28a). The owner
// who fixes an ID flips its it.fails to it in the same commit. The sandbox is an injected fake; the
// command error is the real CommandExitError class exported by the installed e2b SDK.
import { CommandExitError } from "e2b";
import { describe, expect, it } from "vitest";
import { Capsule } from "@capsule-sdk/core";
import { e2b } from "./index.js";

function fakeSandbox(run: () => Promise<{ exitCode: number; stdout: string; stderr: string }>) {
  const state = { killed: 0 };
  const sandbox = {
    sandboxId: "audit-e2b",
    commands: { run },
    files: {
      write: async () => {},
      read: async () => new TextEncoder().encode("artifact body"),
      list: async () => []
    },
    kill: async () => {
      state.killed += 1;
    }
  };
  return { state, adapter: e2b({ sandboxClass: { create: async () => sandbox } as never }) };
}

describe("M1 audit regressions: e2b", () => {
  it.fails("SB-01: the installed SDK CommandExitError is a normal nonzero ExecResult and keeps the sandbox", async () => {
    const commandError = new CommandExitError({ exitCode: 7, stdout: "partial output", stderr: "ordinary test failure", error: "exit status 7" });
    const fake = fakeSandbox(async () => {
      throw commandError;
    });
    const box = await new Capsule({ adapter: fake.adapter, receipts: true }).sandbox.create({});
    const result = await box.exec({ command: ["sh", "-c", "exit 7"] });
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("partial output");
    expect(result.stderr).toBe("ordinary test failure");
    expect(result.receipt).toBeDefined();
    expect(fake.state.killed).toBe(0);
  });

  it.fails("SB-10a: sandbox.artifacts is not claimed unless artifactPaths are actually collected", async () => {
    const fake = fakeSandbox(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const capsule = new Capsule({ adapter: fake.adapter });
    if (!capsule.supports("sandbox.artifacts")) return;
    const box = await capsule.sandbox.create({});
    const result = await box.exec({ command: "true", artifactPaths: ["/workspace/out.txt"] });
    expect(result.artifacts).toHaveLength(1);
  });
});
