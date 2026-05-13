import { describe, expect, test } from "vitest";
import { Capsule } from "./capsule.js";
import { supportLevel, supports } from "./capabilities.js";
import { UnsupportedCapabilityError, PolicyViolationError } from "./errors.js";
import { evaluatePolicy, mergeTimeout, redactLogEntries, redactSecrets } from "./policy.js";
import { createReceipt } from "./receipts.js";
import { MemoryReceiptStore } from "./stores.js";
import type { CapsuleAdapter, CapabilityMap } from "./index.js";

const capabilities: CapabilityMap = {
  sandbox: {
    create: "native",
    exec: "native",
    fileRead: "native",
    fileWrite: "native",
    fileList: "native",
    destroy: "native"
  },
  job: {
    run: "unsupported",
    status: "unsupported",
    cancel: "unsupported",
    logs: "unsupported",
    artifacts: "unsupported",
    timeout: "unsupported",
    env: "unsupported"
  }
};

const adapter: CapsuleAdapter = {
  name: "test",
  provider: "test",
  capabilities,
  sandbox: {
    create: async () => ({
      handle: { id: "box", provider: "test", createdAt: new Date().toISOString() },
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] }),
      writeFile: async () => undefined,
      readFile: async () => new Uint8Array(),
      listFiles: async () => [],
      destroy: async () => undefined
    })
  }
};

describe("capabilities", () => {
  test("looks up capability paths", () => {
    expect(supportLevel(capabilities, "sandbox.exec")).toBe("native");
    expect(supportLevel(capabilities, "service.deploy")).toBe("unsupported");
    expect(supports(capabilities, "sandbox.exec")).toBe(true);
    expect(supports(capabilities, "job.run")).toBe(false);
  });

  test("unsupported capability throws", async () => {
    const capsule = new Capsule({ adapter });
    await expect(capsule.job.run({ image: "node:22" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.status({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.cancel({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.status({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.update({ id: "svc_123", image: "node:22" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.delete({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.version({ deploymentId: "edge_123", name: "worker" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.release({ versionId: "edge_version_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.rollback({ deploymentId: "edge_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.branch.delete({ project: "app", branchId: "br_mock" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.branch.reset({ project: "app", branchId: "br_mock" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.migrate({ project: "app", branchId: "br_mock", dryRun: true })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.status({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.start({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.stop({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.destroy({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });
});

describe("policy", () => {
  test("denies env keys not allowed by secret policy", () => {
    expect(() => evaluatePolicy({ secrets: { allowed: ["SAFE"] } }, { env: { TOKEN: "x" } })).toThrow(PolicyViolationError);
  });

  test("merges timeout against policy maximum", () => {
    expect(mergeTimeout({ limits: { timeoutMs: 1000 } }, 2000)).toBe(1000);
    expect(mergeTimeout({ limits: { timeoutMs: 1000 } }, 500)).toBe(500);
  });

  test("records policy enforcement notes without claiming universal OS enforcement", () => {
    expect(
      evaluatePolicy(
        {
          network: { mode: "none" },
          filesystem: { read: ["/workspace"], write: ["/workspace"] },
          secrets: { allowed: ["SECRET"], redactFromLogs: true },
          limits: { timeoutMs: 1000, memoryMb: 512, cpu: 1 },
          cost: { maxUsd: 1 },
          ttl: { maxMs: 60_000 }
        },
        { env: { SECRET: "value" }, timeoutMs: 2000 }
      ).notes
    ).toEqual([
      "Network policy requested mode=none; enforcement is native only when the adapter/provider explicitly supports network isolation.",
      "Filesystem policy requested; enforcement may be native, emulated at the adapter boundary, or unsupported depending on the runtime.",
      "Secret redaction is applied to Capsule-observed stdout, stderr, and log entries; provider-side logs may need separate controls.",
      "Requested timeout 2000ms reduced to policy maximum 1000ms",
      "CPU and memory limits are delegated to adapter/provider support; Capsule does not claim OS-level enforcement by itself.",
      "Cost policy is a control-plane constraint; provider billing enforcement is not guaranteed by Capsule.",
      "TTL policy is a control-plane cleanup constraint; cleanup depends on adapter/provider lifecycle support."
    ]);
  });

  test("redacts exact secret values from output repeatedly", () => {
    expect(redactSecrets("token=abc token=abc suffix", { SECRET: "abc" }, { secrets: { allowed: ["SECRET"], redactFromLogs: true } })).toBe("token=[REDACTED] token=[REDACTED] suffix");
  });

  test("does not redact when log redaction policy is absent", () => {
    expect(redactSecrets("token=abc", { SECRET: "abc" }, { secrets: { allowed: ["SECRET"] } })).toBe("token=abc");
  });

  test("redacts secret values from log entries", () => {
    expect(
      redactLogEntries(
        [
          { timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", message: "first abc" },
          { timestamp: "2026-01-01T00:00:00.001Z", stream: "stderr", message: "second abc abc" }
        ],
        { SECRET: "abc" },
        { secrets: { allowed: ["SECRET"], redactFromLogs: true } }
      )
    ).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", message: "first [REDACTED]" },
      { timestamp: "2026-01-01T00:00:00.001Z", stream: "stderr", message: "second [REDACTED] [REDACTED]" }
    ]);
  });
});

describe("receipts", () => {
  test("hashes output and includes policy decision", () => {
    const receipt = createReceipt({
      type: "sandbox.exec",
      provider: "test",
      adapter: "test",
      capabilityPath: "sandbox.exec",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:01.000Z"),
      stdout: "hello",
      stderr: "",
      policy: { decision: "allowed", applied: { network: { mode: "none" } } }
    });
    expect(receipt.stdoutHash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(receipt.policy.decision).toBe("allowed");
    expect(receipt.durationMs).toBe(1000);
  });

  test("records receipts into a configured store", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptStore });
    await capsule.sandbox.create({});
    expect(receiptStore.receipts[0]?.type).toBe("sandbox.create");
  });
});
