import { describe, expect, it } from "vitest";
import { run, runAgentCheck } from "./index.js";

describe("agent preview environment", () => {
  it("runs the agent code-execution check in a sandbox", async () => {
    const check = await runAgentCheck();
    expect(check.exitCode).toBe(0);
    // The mock sandbox echoes the executed command rather than running it.
    expect(check.stdout).toContain("node /workspace/smoke.js");
    expect(check.receipt?.type).toBe("sandbox.exec");
  });

  it("provisions and cleans up a preview after a passing check", async () => {
    const result = await run();
    expect(result.provisioned).toBe(true);
    expect(result.createdResources).toBe(3);
    expect(result.cleanupStatus).not.toBe("partial");
    expect(result.receiptCount).toBeGreaterThan(0);
  });
});
