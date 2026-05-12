import { describe, expect, test } from "vitest";
import { assertAdapterContract, assertUnsupportedCapabilitiesReject, Capsule } from "@capsule/core";
import {
  mockCloudRun,
  mockCloudflare,
  mockDaytona,
  mockEC2,
  mockE2B,
  mockECS,
  mockKubernetes,
  mockLambda,
  mockModal,
  mockNeon,
  mockVercel
} from "./index.js";

describe("mock adapters", () => {
  test("mock adapters satisfy the public adapter contract", async () => {
    for (const adapter of [
      mockCloudRun(),
      mockCloudflare(),
      mockDaytona(),
      mockEC2(),
      mockE2B(),
      mockECS(),
      mockKubernetes(),
      mockLambda(),
      mockModal(),
      mockNeon(),
      mockVercel()
    ]) {
      assertAdapterContract(adapter);
      await assertUnsupportedCapabilitiesReject(adapter);
    }
  });

  test("mockE2B capabilities", () => {
    const capsule = new Capsule({ adapter: mockE2B() });
    expect(capsule.supportLevel("sandbox.exec")).toBe("native");
    expect(capsule.supportLevel("job.run")).toBe("emulated");
    expect(capsule.supports("service.deploy")).toBe(false);
  });

  test("mockCloudRun supports service.deploy", () => {
    expect(new Capsule({ adapter: mockCloudRun() }).supportLevel("service.deploy")).toBe("native");
  });

  test("mockVercel supports edge.deploy", () => {
    expect(new Capsule({ adapter: mockVercel() }).supportLevel("edge.deploy")).toBe("native");
  });

  test("mockCloudflare supports edge.deploy", () => {
    expect(new Capsule({ adapter: mockCloudflare() }).supportLevel("edge.deploy")).toBe("native");
  });

  test("mockNeon supports database.branchCreate", () => {
    expect(new Capsule({ adapter: mockNeon() }).supportLevel("database.branchCreate")).toBe("native");
  });

  test("mockEC2 supports machine.create", () => {
    expect(new Capsule({ adapter: mockEC2() }).supportLevel("machine.create")).toBe("native");
  });

  test("mockKubernetes can create experimental machine receipts", async () => {
    const capsule = new Capsule({ adapter: mockKubernetes(), receipts: true });
    const machine = await capsule.machine.create({ name: "runner" });
    expect(machine.receipt?.supportLevel).toBe("experimental");
  });
});
