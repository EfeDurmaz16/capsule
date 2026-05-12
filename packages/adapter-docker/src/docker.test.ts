import { describe, expect, test } from "vitest";
import { assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule } from "@capsule/core";
import { docker, dockerAvailable } from "./index.js";

const hasDocker = await dockerAvailable();

describe("docker adapter", () => {
  test("declares Docker capabilities", () => {
    const capsule = new Capsule({ adapter: docker() });
    expect(capsule.supportLevel("sandbox.exec")).toBe("native");
    expect(capsule.supportLevel("job.run")).toBe("native");
    expect(capsule.supports("service.deploy")).toBe(false);
  });

  test("satisfies the public adapter contract", async () => {
    const adapter = docker();
    assertAdapterContract(adapter);
    await assertUnsupportedCapabilitiesReject(adapter);
  });

  test.skipIf(!hasDocker)("runs Docker job when Docker is available", async () => {
    const capsule = new Capsule({ adapter: docker(), receipts: true });
    const run = await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('docker ok')"], timeoutMs: 30_000 });
    expect(run.result?.stdout).toContain("docker ok");
    expect(run.receipt?.type).toBe("job.run");
  }, 60_000);
});
