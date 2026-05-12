import { describe, expect, test } from "vitest";
import { Capsule, runAdapterContract } from "@capsule/core";
import { liveTest, liveTestGate } from "@capsule/test-utils";
import { docker, dockerAvailable } from "./index.js";

const hasDocker = await dockerAvailable();
const dockerLiveGate = liveTestGate({ provider: "docker" });

describe("docker adapter", () => {
  test("runs the shared adapter contract suite", async () => {
    await runAdapterContract(docker());
  });

  test("declares Docker capabilities", () => {
    const capsule = new Capsule({ adapter: docker() });
    expect(capsule.supportLevel("sandbox.exec")).toBe("native");
    expect(capsule.supportLevel("job.run")).toBe("native");
    expect(capsule.supports("service.deploy")).toBe(false);
  });

  liveTest(
    test,
    "runs Docker job when live tests and Docker are available",
    hasDocker ? dockerLiveGate : { enabled: false, skipReason: "Docker is not available." },
    async () => {
      const capsule = new Capsule({ adapter: docker(), receipts: true });
      const run = await capsule.job.run({ image: "node:22", command: ["node", "-e", "console.log('docker ok')"], timeoutMs: 30_000 });
      expect(run.result?.stdout).toContain("docker ok");
      expect(run.receipt?.type).toBe("job.run");
    },
    60_000
  );
});
