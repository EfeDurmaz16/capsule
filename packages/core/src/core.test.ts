import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Capsule } from "./capsule.js";
import {
  capabilityDiff,
  evaluateCapabilityRequirements,
  explainSupportLevel,
  missingCapabilityRequirements,
  nativeOnlySupportLevels,
  providerCompatibilityScore,
  supportLevel,
  supports,
  uniqueCapabilityPaths
} from "./capabilities.js";
import { createEvidenceBundle, verifyEvidenceBundle } from "./evidence.js";
import {
  AdapterExecutionError,
  CleanupFailureError,
  PolicyViolationError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderRetryableError,
  ProviderValidationError,
  UnsupportedCapabilityError,
  classifyProviderError,
  providerExecutionError
} from "./errors.js";
import { capsuleOperationTag, capsuleOperationTags } from "./idempotency.js";
import { evaluatePolicy, explainPolicy, mergePolicy, mergeTimeout, redactError, redactLogEntries, redactSecrets } from "./policy.js";
import { redactionFixtureObject, redactionFixtureTokens } from "./redaction-fixtures.js";
import {
  agentSafePolicy,
  ciJobPreset,
  costLimitedPreviewPreset,
  dockerLocalAgentPreset,
  edgeWorkerPreset,
  httpServicePreset,
  nodeJobPreset,
  nodeSandboxPreset,
  previewDatabaseBranchPreset,
  previewEnvironmentPreset,
  validatePresetAgainstPolicy
} from "./presets.js";
import { capsuleReceiptJsonSchema } from "./receipt-schema.js";
import {
  CAPSULE_RECEIPT_SCHEMA_VERSION,
  canonicalReceiptPayload,
  createReceipt,
  providerRuntimeMetadata,
  verifyReceipt,
  verifyReceiptSignature
} from "./receipts.js";
import { MemoryReceiptStore } from "./stores.js";
import { adapterContractFixtureKinds, adapterContractFixtures, assertAdapterContract, runCapsuleAdapterContract } from "./contract.js";
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

function validateAgainstSimpleSchema(schema: any, value: any, path = "$"): string[] {
  const errors: string[] = [];
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path} must be object`];
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties?.[key]) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validateAgainstSimpleSchema(childSchema, value[key], `${path}.${key}`));
    }
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be array`];
    value.forEach((item, index) => errors.push(...validateAgainstSimpleSchema(schema.items, item, `${path}[${index}]`)));
  }
  if (schema.type === "string" && typeof value !== "string") errors.push(`${path} must be string`);
  if (schema.type === "number" && typeof value !== "number") errors.push(`${path} must be number`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  return errors;
}

describe("capabilities", () => {
  test("looks up capability paths", () => {
    expect(supportLevel(capabilities, "sandbox.exec")).toBe("native");
    expect(supportLevel(capabilities, "service.deploy")).toBe("unsupported");
    expect(supports(capabilities, "sandbox.exec")).toBe(true);
    expect(supports(capabilities, "job.run")).toBe(false);
  });

  test("treats nested or malformed capability paths as unsupported", () => {
    expect(supportLevel(capabilities, "sandbox.exec.extra" as any)).toBe("unsupported");
    expect(supportLevel(capabilities, "sandbox." as any)).toBe("unsupported");
    expect(supportLevel(capabilities, ".exec" as any)).toBe("unsupported");
    expect(supports(capabilities, "sandbox.exec.extra" as any)).toBe(false);
  });

  test("evaluates required and optional capability sets", () => {
    expect(
      evaluateCapabilityRequirements(capabilities, [
        "sandbox.exec",
        { path: "sandbox.snapshot", optional: true, reason: "Used only when checkpointing is enabled" },
        { path: "sandbox.fileWrite", levels: nativeOnlySupportLevels }
      ])
    ).toEqual([
      {
        path: "sandbox.exec",
        actualLevel: "native",
        acceptedLevels: ["native", "emulated", "experimental"],
        supported: true,
        optional: false,
        reason: undefined
      },
      {
        path: "sandbox.snapshot",
        actualLevel: "unsupported",
        acceptedLevels: ["native", "emulated", "experimental"],
        supported: false,
        optional: true,
        reason: "Used only when checkpointing is enabled"
      },
      {
        path: "sandbox.fileWrite",
        actualLevel: "native",
        acceptedLevels: ["native"],
        supported: true,
        optional: false,
        reason: undefined
      }
    ]);
  });

  test("returns only missing non-optional requirements", () => {
    expect(missingCapabilityRequirements(capabilities, ["sandbox.exec", "service.deploy", { path: "sandbox.snapshot", optional: true }])).toEqual([
      {
        path: "service.deploy",
        actualLevel: "unsupported",
        acceptedLevels: ["native", "emulated", "experimental"],
        supported: false,
        optional: false,
        reason: undefined
      }
    ]);
  });

  test("explains support levels with remediation guidance", () => {
    expect(explainSupportLevel(capabilities, "sandbox.exec")).toEqual({
      path: "sandbox.exec",
      level: "native",
      supported: true,
      summary: "The adapter/provider declares first-class support for this capability.",
      guidance: "sandbox.exec can be used without Capsule-side emulation warnings."
    });
    expect(explainSupportLevel(capabilities, "service.deploy")).toEqual({
      path: "service.deploy",
      level: "unsupported",
      supported: false,
      summary: "The adapter/provider does not support this capability.",
      guidance: "Choose another adapter, change the workflow requirements, or use a provider-specific escape hatch for service.deploy."
    });
  });

  test("diffs provider capability maps", () => {
    const other: CapabilityMap = {
      ...capabilities,
      sandbox: {
        ...capabilities.sandbox!,
        snapshot: "experimental"
      },
      job: {
        ...capabilities.job!,
        run: "native"
      }
    };

    expect(uniqueCapabilityPaths(capabilities, other)).toContain("sandbox.snapshot");
    expect(capabilityDiff(capabilities, other, ["sandbox.exec", "sandbox.snapshot", "job.run"])).toEqual([
      { path: "sandbox.snapshot", left: "unsupported", right: "experimental" },
      { path: "job.run", left: "unsupported", right: "native" }
    ]);
  });

  test("scores provider compatibility by support level and required coverage", () => {
    const scored: CapabilityMap = {
      sandbox: {
        create: "native",
        exec: "native",
        fileRead: "native",
        fileWrite: "emulated",
        fileList: "experimental",
        destroy: "native",
        snapshot: "unsupported"
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

    expect(
      providerCompatibilityScore(scored, [
        "sandbox.create",
        { path: "sandbox.fileWrite", levels: ["native"] },
        { path: "sandbox.fileList" },
        { path: "sandbox.snapshot", optional: true },
        { path: "job.run", optional: true }
      ])
    ).toMatchObject({
      score: 40,
      requiredScore: 0.4667,
      optionalScore: 0,
      requiredSatisfied: 2,
      requiredTotal: 3,
      optionalSatisfied: 0,
      optionalTotal: 2,
      missingRequired: [
        expect.objectContaining({
          path: "sandbox.fileWrite",
          actualLevel: "emulated",
          acceptedLevels: ["native"],
          supported: false
        })
      ]
    });
  });

  test("unsupported capability throws", async () => {
    const capsule = new Capsule({ adapter });
    const runError = await capsule.job.run({ image: "node:22" }).catch((error: unknown) => error);
    expect(runError).toMatchObject({
      name: "UnsupportedCapabilityError",
      capabilityPath: "job.run",
      remediation: "Choose another adapter, change the workflow requirements, or use a provider-specific escape hatch for job.run."
    });
    expect(runError).toBeInstanceOf(UnsupportedCapabilityError);
    expect((runError as Error).message).toContain("Capability is unsupported: job.run");
    expect((runError as Error).message).toContain(
      "Choose another adapter, change the workflow requirements, or use a provider-specific escape hatch for job.run."
    );
    expect((runError as Error).message).toContain("Docs: https://github.com/EfeDurmaz16/capsule/blob/main/docs/capability-model.md");
    expect((runError as Error).message).toContain(
      "Safe retry: inspect adapter capabilities or choose a supported adapter before retrying; Capsule failed before provider execution."
    );
    await expect(capsule.job.status({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.cancel({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.job.logs({ id: "job_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.status({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.update({ id: "svc_123", image: "node:22" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.rollback({ id: "svc_123", revision: "svc_123-00001-abc" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.delete({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.service.logs({ id: "svc_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.version({ deploymentId: "edge_123", name: "worker" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.release({ versionId: "edge_version_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.rollback({ deploymentId: "edge_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.edge.logs({ id: "edge_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.branch.delete({ project: "app", branchId: "br_mock" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.branch.reset({ project: "app", branchId: "br_mock" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.database.migrate({ project: "app", branchId: "br_mock", dryRun: true })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.destroy({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.status({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.logs({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.urls({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.preview.cleanup({ id: "preview_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.status({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.start({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.stop({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(capsule.machine.destroy({ id: "machine_123" })).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  test("contract rejects declared log support without implementation", () => {
    const dishonestAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        job: {
          ...capabilities.job!,
          run: "native",
          logs: "native"
        }
      },
      job: {
        run: async () => ({ id: "job_123", provider: "test", status: "succeeded" })
      }
    };

    expect(() => assertAdapterContract(dishonestAdapter)).toThrow("declares job.logs as native but does not implement the public contract");
  });

  test("contract can be scoped to selected domains for adapter authors", async () => {
    const partialAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "native",
          update: "unsupported",
          delete: "unsupported",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      }
    };

    await expect(runCapsuleAdapterContract(partialAdapter, { domains: ["sandbox"] })).resolves.toBeUndefined();
    await expect(runCapsuleAdapterContract(partialAdapter, { domains: ["service"] })).rejects.toThrow(
      "declares service.deploy as native but does not implement the public contract"
    );
  });

  test("contract verifies supported mutating capabilities fail closed under approval policy", async () => {
    let calls = 0;
    const guardedAdapter: CapsuleAdapter = {
      name: "guarded",
      provider: "test",
      capabilities: {
        job: {
          run: "native",
          status: "unsupported",
          cancel: "unsupported",
          logs: "unsupported",
          artifacts: "unsupported",
          timeout: "unsupported",
          env: "unsupported"
        }
      },
      job: {
        run: async () => {
          calls += 1;
          return { id: "job_123", provider: "test", status: "succeeded" };
        }
      }
    };

    await expect(runCapsuleAdapterContract(guardedAdapter, { capabilities: ["job.run"] })).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  test("contract runs adapter-specific failure scenarios for cleanup metadata and receipt binding", async () => {
    const failingAdapter: CapsuleAdapter = {
      name: "failure-contract",
      provider: "test",
      capabilities: {
        service: {
          deploy: "native",
          update: "unsupported",
          delete: "unsupported",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async (spec, context) => {
          if (spec.name === "bad-receipt") {
            context.createReceipt({
              type: "job.run",
              capabilityPath: "job.run",
              startedAt: new Date(),
              policy: { decision: "allowed", applied: context.policy }
            });
          }
          const error = new AdapterExecutionError("service deploy failed after partial allocation");
          (error as AdapterExecutionError & { cleanup?: Record<string, unknown> }).cleanup = { action: "delete-service", status: "deleted" };
          throw error;
        }
      }
    };

    await expect(
      runCapsuleAdapterContract(failingAdapter, {
        capabilities: ["service.deploy"],
        failureScenarios: [
          {
            name: "partial cleanup",
            exercise: (capsule) => capsule.service.deploy({ name: "partial", image: "node:22" }),
            expectError: (error) => {
              expect(error).toMatchObject({ cleanup: { action: "delete-service", status: "deleted" } });
            }
          },
          {
            name: "receipt binding",
            exercise: (capsule) => capsule.service.deploy({ name: "bad-receipt", image: "node:22" }),
            expectError: (error) => {
              expect((error as Error).message).toContain("outside active operation receipt scope");
            }
          }
        ]
      })
    ).resolves.toBeUndefined();
  });

  test("contract exposes reusable fixtures for adapter author scenarios", () => {
    expect(adapterContractFixtureKinds).toEqual(["allow", "deny", "unsupported", "partialFailure", "cleanup", "receipt", "liveSkip", "logs", "lifecycle"]);
    expect(adapterContractFixtures.allow).toMatchObject({
      kind: "allow",
      capabilityPath: "job.run",
      capsuleOptions: { policy: {} }
    });
    expect(adapterContractFixtures.deny).toMatchObject({
      kind: "deny",
      capabilityPath: "job.run",
      capsuleOptions: { policy: { approvals: { required: true, reason: "adapter contract deny fixture" } } }
    });
    expect(adapterContractFixtures.unsupported).toMatchObject({
      kind: "unsupported",
      capabilityPath: "job.run",
      expectedError: "UnsupportedCapabilityError"
    });
    expect(adapterContractFixtures.partialFailure).toMatchObject({
      kind: "partialFailure",
      capabilityPath: "service.deploy",
      spec: { name: "partial", image: "node:22" },
      expectedError: "AdapterExecutionError"
    });
    expect(adapterContractFixtures.cleanup.cleanup).toMatchObject({ action: "delete-resource", status: "deleted" });
    expect(adapterContractFixtures.receipt).toMatchObject({
      kind: "receipt",
      capsuleOptions: { receipts: true },
      expectedReceiptTypes: ["job.run"]
    });
    expect(adapterContractFixtures.liveSkip).toMatchObject({
      kind: "liveSkip",
      skipReasonIncludes: "CAPSULE_LIVE_TESTS=1"
    });
    expect(adapterContractFixtures.logs).toMatchObject({
      kind: "logs",
      capabilityPath: "job.logs",
      expectedReceiptTypes: ["job.logs"]
    });
    expect(adapterContractFixtures.lifecycle).toMatchObject({
      kind: "lifecycle",
      capabilityPath: "sandbox.create",
      expectedReceiptTypes: ["sandbox.create", "sandbox.destroy"]
    });
    expect(adapterContractFixtures.lifecycle.cleanup).toMatchObject({ action: "destroy-resource", status: "destroyed" });
  });

  test("contract rejects declared preview lifecycle support without implementation", () => {
    const dishonestAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        preview: {
          create: "native",
          destroy: "native",
          status: "native",
          logs: "native",
          urls: "native",
          cleanup: "native"
        }
      },
      preview: {
        create: async () => ({
          id: "preview_123",
          provider: "test",
          name: "preview",
          status: "ready",
          urls: [],
          resources: []
        })
      }
    };

    expect(() => assertAdapterContract(dishonestAdapter)).toThrow("declares preview.destroy as native but does not implement the public contract");
  });
});

describe("policy", () => {
  test("denies env keys not allowed by secret policy", () => {
    expect(() => evaluatePolicy({ secrets: { allowed: ["SAFE"] } }, { env: { TOKEN: "x" } })).toThrow(PolicyViolationError);
  });

  test("fails closed when approval policy is required but not satisfied", () => {
    expect(() => evaluatePolicy({ approvals: { required: true, reason: "production cleanup" } })).toThrow(PolicyViolationError);
    expect(
      evaluatePolicy({ approvals: { required: true, reason: "production cleanup" } }, { approval: { approved: true, reason: "ticket approved" } }).notes
    ).toContain("Approval satisfied: ticket approved");
  });

  test("denies expired approval grants", () => {
    expect(() =>
      evaluatePolicy(
        { approvals: { required: true, reason: "production cleanup" } },
        {
          approval: { approved: true, id: "ticket-123", expiresAt: "2026-01-01T00:00:00.000Z" },
          now: new Date("2026-01-01T00:00:01.000Z")
        }
      )
    ).toThrow(PolicyViolationError);
  });

  test("denies approval grants outside their capability scope", () => {
    expect(() =>
      evaluatePolicy(
        { approvals: { required: true, reason: "production cleanup" } },
        {
          capabilityPath: "service.delete",
          approval: { approved: true, id: "ticket-123", capabilities: ["job.cancel"] }
        }
      )
    ).toThrow(PolicyViolationError);

    expect(
      evaluatePolicy(
        { approvals: { required: true, reason: "production cleanup" } },
        {
          capabilityPath: "service.delete",
          approval: { approved: true, id: "ticket-123", capabilities: ["service.delete"] }
        }
      ).notes
    ).toContain("Approval capability scope satisfied: service.delete");
  });

  test("denies approval grants outside their resource scope", () => {
    expect(() =>
      evaluatePolicy(
        { approvals: { required: true, reason: "production cleanup" } },
        {
          capabilityPath: "service.delete",
          resource: { type: "service", id: "svc_456" },
          approval: { approved: true, id: "ticket-123", capabilities: ["service.delete"], resources: [{ type: "service", id: "svc_123" }] }
        }
      )
    ).toThrow(PolicyViolationError);

    expect(
      evaluatePolicy(
        { approvals: { required: true, reason: "production cleanup" } },
        {
          capabilityPath: "service.delete",
          resource: { type: "service", id: "svc_123" },
          approval: { approved: true, id: "ticket-123", capabilities: ["service.delete"], resources: [{ type: "service", id: "svc_123" }] }
        }
      ).notes
    ).toContain("Approval resource scope satisfied: service:svc_123");
  });

  test("records replayable policy decisions with adapter support level", async () => {
    const receiptStore = new MemoryReceiptStore();
    const policy = { approvals: { required: true, reason: "production cleanup" } };
    const approval = {
      approved: true,
      id: "ticket-123",
      capabilities: ["service.delete"],
      resources: [{ type: "service", id: "svc_123" }]
    };
    const replayAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "unsupported",
          update: "unsupported",
          delete: "native",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async () => ({ id: "svc_123", provider: "test", name: "svc", status: "ready" }),
        delete: async (_spec, context) => {
          const policyDecision = context.evaluatePolicy();
          context.createReceipt({
            type: "service.delete",
            capabilityPath: "service.delete",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            policy: policyDecision,
            resource: { id: "svc_123", status: "deleted" }
          });
          return { id: "svc_123", provider: "test", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({ adapter: replayAdapter, policy, receipts: true, receiptStore });

    await capsule.service.delete({ id: "svc_123", approval });

    const replayed = evaluatePolicy(policy, {
      approval,
      capabilityPath: "service.delete",
      resource: { type: "service", id: "svc_123" },
      supportLevel: "native"
    });
    expect(receiptStore.receipts[0]?.supportLevel).toBe("native");
    expect(replayed.notes).toContain("Adapter support level for service.delete: native.");
    expect(receiptStore.receipts[0]?.policy).toEqual(replayed);
  });

  test("explains allowed policy decisions without throwing", () => {
    expect(
      explainPolicy(
        { secrets: { allowed: ["SAFE"] } },
        {
          capabilityPath: "job.run",
          supportLevel: "native",
          env: { SAFE: "ok" }
        }
      )
    ).toMatchObject({
      decision: "allowed",
      violations: [],
      input: {
        envKeys: ["SAFE"]
      },
      notes: ["Adapter support level for job.run: native."]
    });
  });

  test("explains denied policy decisions without throwing", () => {
    expect(explainPolicy({ approvals: { required: true, reason: "production cleanup" } }, { capabilityPath: "service.delete" })).toMatchObject({
      decision: "denied",
      reason: "Approval required by policy: production cleanup",
      violations: ["production cleanup"]
    });
  });

  test("denies ttl-scoped work above the policy maximum", () => {
    expect(() => evaluatePolicy({ ttl: { maxMs: 60_000 } }, { ttlMs: 120_000 })).toThrow(PolicyViolationError);
    expect(evaluatePolicy({ ttl: { maxMs: 60_000 } }, { ttlMs: 30_000 }).notes).toContain("TTL policy maximum 60000ms applies to this request.");
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

  test("derives enforcement mode conservatively from adapter support level", () => {
    expect(evaluatePolicy({}, {}).enforcement).toBe("delegated");
    expect(evaluatePolicy({}, { capabilityPath: "job.run", supportLevel: "native" }).enforcement).toBe("native");
    expect(evaluatePolicy({}, { capabilityPath: "job.run", supportLevel: "emulated" }).enforcement).toBe("delegated");
    expect(evaluatePolicy({}, { capabilityPath: "job.run", supportLevel: "unsupported" }).enforcement).toBe("unsupported");
    expect(evaluatePolicy({}, { enforcement: "advisory" }).enforcement).toBe("advisory");
  });

  test("records a policy evaluation trace alongside notes", () => {
    const decision = evaluatePolicy(
      { network: { mode: "none" }, secrets: { allowed: ["SECRET"] } },
      { env: { SECRET: "value" }, capabilityPath: "sandbox.exec", supportLevel: "native" }
    );
    expect(decision.trace).toEqual([
      { check: "network", verdict: "noted" },
      { check: "support-level", verdict: "noted" },
      { check: "secrets", verdict: "passed" }
    ]);
  });

  test("surfaces a denied trace entry for denied decisions", () => {
    expect(explainPolicy({ approvals: { required: true, reason: "production cleanup" } }, {}).trace).toEqual([
      { check: "production cleanup", verdict: "denied" }
    ]);
  });

  test("builds a cost decision object when the policy declares a cost limit", () => {
    expect(evaluatePolicy({ cost: { maxUsd: 5 } }, { costUsd: 3 }).cost).toEqual({ requestedUsd: 3, limitUsd: 5, withinLimit: true });
    expect(evaluatePolicy({ cost: { maxUsd: 5 } }, { costUsd: 8 }).cost).toEqual({ requestedUsd: 8, limitUsd: 5, withinLimit: false });
    expect(evaluatePolicy({ cost: { maxUsd: 5 } }, {}).cost).toEqual({ limitUsd: 5, withinLimit: true });
    expect(evaluatePolicy({}, {}).cost).toBeUndefined();
  });

  test("builds a ttl decision object when the policy declares a ttl limit", () => {
    expect(evaluatePolicy({ ttl: { maxMs: 60_000 } }, { ttlMs: 30_000 }).ttl).toEqual({ requestedMs: 30_000, limitMs: 60_000, withinLimit: true });
    expect(evaluatePolicy({ ttl: { maxMs: 60_000 } }, {}).ttl).toEqual({ limitMs: 60_000, withinLimit: true });
    expect(evaluatePolicy({}, {}).ttl).toBeUndefined();
  });

  test("reports network allowlist diagnostics with adapter support level", () => {
    expect(
      evaluatePolicy({ network: { mode: "allowlist", allowedHosts: ["api.example.com", "cdn.example.com"] } }, { networkPolicySupport: "emulated" }).network
    ).toEqual({
      mode: "allowlist",
      support: "emulated",
      hosts: [
        { host: "api.example.com", allowed: true },
        { host: "cdn.example.com", allowed: true }
      ]
    });
    expect(evaluatePolicy({ network: { mode: "none", allowedHosts: ["api.example.com"] } }, {}).network).toEqual({
      mode: "none",
      support: "unknown",
      hosts: [{ host: "api.example.com", allowed: false }]
    });
  });

  test("merges policies toward the stricter side per field", () => {
    const merged = mergePolicy(
      {
        network: { mode: "allowlist", allowedHosts: ["a.com", "b.com"] },
        secrets: { allowed: ["A", "B"], redactionProfile: "standard", redactKeys: ["x"] },
        limits: { timeoutMs: 2000, memoryMb: 512 },
        cost: { maxUsd: 10 },
        ttl: { maxMs: 60_000 },
        filesystem: { read: ["/a", "/b"] }
      },
      {
        network: { mode: "none", allowedHosts: ["b.com", "c.com"] },
        secrets: { allowed: ["B", "C"], redactFromLogs: true, redactionProfile: "strict", redactKeys: ["y"] },
        limits: { timeoutMs: 1000 },
        cost: { maxUsd: 5 },
        ttl: { maxMs: 30_000 },
        filesystem: { read: ["/b", "/c"] }
      }
    );
    expect(merged).toEqual({
      network: { mode: "none", allowedHosts: ["b.com"] },
      secrets: { allowed: ["B"], redactFromLogs: true, redactionProfile: "strict", redactKeys: ["x", "y"] },
      limits: { timeoutMs: 1000, memoryMb: 512 },
      cost: { maxUsd: 5 },
      ttl: { maxMs: 30_000 },
      filesystem: { read: ["/b"] }
    });
  });

  test("mergePolicy keeps a single declared side and ORs approvals toward safety", () => {
    expect(mergePolicy({ limits: { timeoutMs: 1000 } }, {})).toEqual({ limits: { timeoutMs: 1000 } });
    expect(mergePolicy({}, { approvals: { required: true, reason: "override" } }).approvals).toEqual({ required: true, reason: "override" });
    expect(mergePolicy({ approvals: { required: true } }, { approvals: {} }).approvals).toEqual({ required: true });
  });

  test("redaction fixtures are redacted on the default profile", () => {
    for (const fixture of redactionFixtureTokens) {
      expect(redactSecrets(fixture.value, undefined, {})).toContain("[REDACTED]");
    }
    const redacted = redactError(redactionFixtureObject, undefined, {}) as typeof redactionFixtureObject;
    expect(redacted.safe).toBe(redactionFixtureObject.safe);
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.nested.password).toBe("[REDACTED]");
    expect(redacted.nested.token).toBe("[REDACTED]");
  });

  test("redacts exact secret values from output repeatedly", () => {
    expect(redactSecrets("token=abc token=abc suffix", { SECRET: "abc" }, { secrets: { allowed: ["SECRET"], redactFromLogs: true } })).toBe(
      "token=[REDACTED] token=[REDACTED] suffix"
    );
  });

  test("redacts token-like values when strict redaction profile is enabled", () => {
    expect(redactSecrets("provider returned Bearer <SK_LIVE_REDACTED>", undefined, { secrets: { redactionProfile: "strict" } })).toBe(
      "provider returned Bearer [REDACTED]"
    );
  });

  test("redacts credential-shaped tokens under the default redaction profile", () => {
    expect(redactSecrets("provider returned Bearer abc.def-123", undefined, {})).toBe("provider returned Bearer [REDACTED]");
    expect(redactSecrets("bearer xyz987 rejected", undefined, {})).toBe("bearer [REDACTED] rejected");
    expect(redactSecrets("key sk_live_abcdefghijklmnop123 leaked", undefined, {})).toBe("key [REDACTED] leaked");
    expect(redactSecrets("pat ghp_abcdefghijklmnopqrstu leaked", undefined, {})).toBe("pat [REDACTED] leaked");
    expect(redactSecrets("aws AKIAIOSFODNN7EXAMPLE used", undefined, {})).toBe("aws [REDACTED] used");
    expect(redactSecrets("dsn postgresql://user:pass@host/db failed", undefined, {})).toBe("dsn [REDACTED] failed");
    expect(redactSecrets("arg password=hunter2&x=1", undefined, {})).toBe("arg [REDACTED]&x=1");
  });

  test("redacts credential-shaped values from receipt command, source, and cwd at creation", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      command: ["psql", "postgresql://user:pass@host/db", "--file", "run.sql"],
      cwd: "/workspace",
      source: { repository: "https://example.com/repo.git", token: "irrelevant" },
      policy: { decision: "allowed", applied: {} }
    });

    expect(receipt.command).toEqual(["psql", "[REDACTED]", "--file", "run.sql"]);
    expect(receipt.cwd).toBe("/workspace");
    expect(receipt.source).toEqual({ repository: "https://example.com/repo.git", token: "[REDACTED]" });
    expect(verifyReceipt(receipt).redaction.findings).toEqual([]);
  });

  test("keeps long non-credential strings unless the strict profile is enabled", () => {
    const hash = "a".repeat(64);
    expect(redactSecrets(`sha ${hash}`, undefined, {})).toBe(`sha ${hash}`);
    expect(redactSecrets(`sha ${hash}`, undefined, { secrets: { redactionProfile: "strict" } })).toBe("sha [REDACTED]");
  });

  test("redacts sensitive provider payloads from error causes", () => {
    const error = new AdapterExecutionError("provider failed", {
      authorization: "Bearer <SK_LIVE_REDACTED>",
      nested: { sessionId: "custom-secret-value" }
    });
    const redacted = redactError(error, undefined, { secrets: { redactionProfile: "strict", redactKeys: ["sessionId"] } }) as AdapterExecutionError;

    expect(redacted.cause).toEqual({
      authorization: "[REDACTED]",
      nested: { sessionId: "[REDACTED]" }
    });
  });

  test("classifies rate-limit provider errors and retry-after hints", () => {
    expect(classifyProviderError({ status: 429, headers: { "retry-after": "2" } })).toEqual({
      category: "rate-limit",
      retryable: true,
      status: 429,
      retryAfterMs: 2000
    });
    expect(classifyProviderError({ error: { code: "RESOURCE_EXHAUSTED" } })).toMatchObject({ category: "rate-limit", retryable: true });
  });

  test("classifies provider auth and validation errors", () => {
    expect(classifyProviderError({ status: 401 })).toMatchObject({ category: "auth", retryable: false });
    expect(classifyProviderError({ status: 403, error: { error: { status: "PERMISSION_DENIED" } } })).toMatchObject({ category: "auth", retryable: false });
    expect(classifyProviderError({ status: 400 })).toMatchObject({ category: "validation", retryable: false });
    expect(classifyProviderError({ status: 422, error: { code: "INVALID_ARGUMENT" } })).toMatchObject({ category: "validation", retryable: false });
  });

  test("classifies transient provider and network errors as retryable", () => {
    expect(classifyProviderError({ status: 503 })).toMatchObject({ category: "retryable", retryable: true });
    expect(classifyProviderError({ status: 408 })).toMatchObject({ category: "retryable", retryable: true });
    expect(classifyProviderError({ error: { code: "ECONNRESET" } })).toMatchObject({ category: "retryable", retryable: true, code: "ECONNRESET" });
  });

  test("falls back to unknown provider error classification", () => {
    expect(classifyProviderError({ error: { message: "unexpected provider response" } })).toEqual({
      category: "unknown",
      retryable: false
    });
  });

  test("maps provider classifications to typed execution errors", () => {
    const auth = providerExecutionError("provider auth failed", { category: "auth", retryable: false, status: 401 }, { status: 401 });
    expect(auth).toBeInstanceOf(ProviderAuthError);
    expect(auth).toBeInstanceOf(AdapterExecutionError);
    expect(auth.code).toBe("CAPSULE_PROVIDER_AUTH_ERROR");

    const validation = providerExecutionError("provider rejected request", { category: "validation", retryable: false, status: 422 }, { status: 422 });
    expect(validation).toBeInstanceOf(ProviderValidationError);
    expect(validation.code).toBe("CAPSULE_PROVIDER_VALIDATION_ERROR");

    const rateLimit = providerExecutionError(
      "provider rate limited request",
      { category: "rate-limit", retryable: true, status: 429, retryAfterMs: 1000 },
      { status: 429 }
    );
    expect(rateLimit).toBeInstanceOf(ProviderRateLimitError);
    expect(rateLimit.code).toBe("CAPSULE_PROVIDER_RATE_LIMIT_ERROR");

    const retryable = providerExecutionError("provider retryable failure", { category: "retryable", retryable: true, status: 503 }, { status: 503 });
    expect(retryable).toBeInstanceOf(ProviderRetryableError);
    expect(retryable.code).toBe("CAPSULE_PROVIDER_RETRYABLE_ERROR");

    const unknown = providerExecutionError("provider failed", { category: "unknown", retryable: false }, {});
    expect(unknown).toBeInstanceOf(AdapterExecutionError);
    expect(unknown).not.toBeInstanceOf(ProviderAuthError);
    expect(unknown.code).toBe("CAPSULE_ADAPTER_EXECUTION_ERROR");

    const cause = new Error("provider transport failed");
    const withErrorCause = providerExecutionError("provider failed", { category: "retryable", retryable: true }, cause);
    expect(withErrorCause.cause).toMatchObject({
      providerError: { category: "retryable", retryable: true },
      cause: expect.objectContaining({ message: "provider transport failed" })
    });
  });

  test("exposes cleanup failure as a typed adapter execution error", () => {
    const cleanup = { action: "delete-created-resource", resourceId: "res_123", status: "failed", error: "delete failed" };
    const error = new CleanupFailureError("cleanup failed after provider allocation", cleanup, { operationError: new Error("deploy failed") });
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect(error.code).toBe("CAPSULE_CLEANUP_FAILURE");
    expect(error.cleanup).toEqual(cleanup);
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

  test("enforces approval policy before destructive adapter operations", async () => {
    let called = false;
    const destructiveAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "unsupported",
          update: "unsupported",
          delete: "native",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async () => ({ id: "svc_123", provider: "test", name: "svc", status: "ready" }),
        delete: async (_spec, context) => {
          context.evaluatePolicy();
          called = true;
          return { id: "svc_123", provider: "test", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({ adapter: destructiveAdapter, policy: { approvals: { required: true, reason: "production cleanup" } } });

    await expect(capsule.service.delete({ id: "svc_123" })).rejects.toThrow(PolicyViolationError);
    expect(called).toBe(false);
    await expect(capsule.service.delete({ id: "svc_123", approval: { approved: true, id: "ticket-123", reason: "approved by ops" } })).resolves.toMatchObject({
      id: "svc_123",
      status: "deleted"
    });
    expect(called).toBe(true);
  });

  test("enforces approval capability scope before destructive adapter operations", async () => {
    let called = false;
    const scopedAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "unsupported",
          update: "unsupported",
          delete: "native",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async () => ({ id: "svc_123", provider: "test", name: "svc", status: "ready" }),
        delete: async () => {
          called = true;
          return { id: "svc_123", provider: "test", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({ adapter: scopedAdapter, policy: { approvals: { required: true, reason: "production cleanup" } } });

    await expect(capsule.service.delete({ id: "svc_123", approval: { approved: true, id: "ticket-123", capabilities: ["job.cancel"] } })).rejects.toThrow(
      PolicyViolationError
    );
    expect(called).toBe(false);
  });

  test("enforces ttl policy before creating ttl-scoped resources", async () => {
    let called = false;
    const ttlAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        database: {
          branchCreate: "native",
          branchDelete: "unsupported",
          connectionString: "unsupported"
        }
      },
      database: {
        branch: {
          create: async () => {
            called = true;
            return { id: "br_123", provider: "test", project: "app", name: "preview", status: "ready" };
          }
        }
      }
    };
    const capsule = new Capsule({ adapter: ttlAdapter, policy: { ttl: { maxMs: 60_000 } } });

    await expect(capsule.database.branch.create({ project: "app", name: "preview", ttlMs: 120_000 })).rejects.toThrow(PolicyViolationError);
    expect(called).toBe(false);
  });

  test("raw provider access bypasses Capsule policy and receipt controls", async () => {
    const receiptStore = new MemoryReceiptStore();
    let rawCalled = false;
    const rawAdapter: CapsuleAdapter = {
      ...adapter,
      raw: {
        deleteService: async () => {
          rawCalled = true;
          return { id: "svc_123", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({
      adapter: rawAdapter,
      receipts: true,
      receiptStore,
      policy: { approvals: { required: true, reason: "raw access is outside the governed facade" } }
    });

    await expect((capsule.raw() as { deleteService(): Promise<{ id: string; status: string }> }).deleteService()).resolves.toEqual({
      id: "svc_123",
      status: "deleted"
    });
    expect(rawCalled).toBe(true);
    expect(receiptStore.receipts).toEqual([]);
  });
});

describe("presets", () => {
  test("creates an agent-safe Node sandbox preset without hiding capabilities", () => {
    const preset = nodeSandboxPreset({ timeoutMs: 5_000, secretEnv: ["TOKEN"] });

    expect(preset.domain).toBe("sandbox");
    expect(preset.capabilityPaths).toEqual(["sandbox.create", "sandbox.exec", "sandbox.fileWrite", "sandbox.destroy"]);
    expect(preset.spec).toMatchObject({ image: "node:22", cwd: "/workspace", timeoutMs: 5_000 });
    expect(preset.policy).toEqual({
      network: { mode: "none" },
      filesystem: { read: ["/workspace"], write: ["/workspace"] },
      secrets: { allowed: ["TOKEN"], redactFromLogs: true },
      limits: { timeoutMs: 5_000, memoryMb: undefined, cpu: undefined }
    });
  });

  test("creates domain-specific provider specs while keeping notes explicit", () => {
    expect(nodeJobPreset({ command: ["node", "-e", "console.log(1)"] }).capabilityPaths).toEqual(["job.run"]);
    expect(httpServicePreset({ name: "api", image: "example/api", healthPath: "/health" }).spec).toMatchObject({
      name: "api",
      image: "example/api",
      ports: [{ port: 8080, public: true, protocol: "http" }],
      healthcheck: { path: "/health" }
    });
    expect(edgeWorkerPreset({ name: "worker" }).spec.runtime).toBe("workers");
    expect(previewDatabaseBranchPreset({ project: "app", name: "pr-42", ttlMs: 60_000 }).policy).toEqual({ ttl: { maxMs: 60_000 } });
    expect(previewEnvironmentPreset({ name: "pr-42" }).capabilityPaths).toEqual(["preview.create", "preview.destroy", "preview.urls"]);
  });

  test("rejects invalid core preset inputs before adapter execution", () => {
    expect(() => nodeJobPreset({ command: "" })).toThrow("node-job command is required");
    expect(() => nodeJobPreset({ command: [] })).toThrow("node-job command is required");
    expect(() => httpServicePreset({ name: "", image: "example/api" })).toThrow("http-service name is required");
    expect(() => httpServicePreset({ name: "api" } as any)).toThrow("http-service requires image or source");
    expect(() => httpServicePreset({ name: "api", image: "example/api", port: 70_000 })).toThrow("http-service port must be between 1 and 65535");
    expect(() => previewDatabaseBranchPreset({ project: "", name: "pr-42" })).toThrow("preview-database-branch project is required");
    expect(() => previewEnvironmentPreset({ name: "pr-42", ttlMs: 0 })).toThrow("preview-environment ttlMs must be greater than 0");
  });

  test("requires agent-safe allowlist policies to include explicit hosts", () => {
    expect(() => agentSafePolicy({ network: { mode: "allowlist" } })).toThrow("network allowlist requires at least one allowed host");
    expect(agentSafePolicy({ network: { mode: "allowlist", allowedHosts: ["api.example.com"] } }).network).toEqual({
      mode: "allowlist",
      allowedHosts: ["api.example.com"]
    });
  });

  test("wraps nodeJobPreset with CI defaults", () => {
    const preset = ciJobPreset({ command: ["pnpm", "test"] });

    expect(preset.name).toBe("ci-job");
    expect(preset.domain).toBe("job");
    expect(preset.capabilityPaths).toEqual(["job.run"]);
    expect(preset.spec.env).toEqual({ CI: "true" });
    expect(preset.spec.timeoutMs).toBe(900_000);
    expect(preset.spec.labels).toEqual({ "capsule.io/preset": "ci-job" });
    expect(preset.policy?.limits?.timeoutMs).toBe(900_000);
  });

  test("lets ci-job callers override the CI defaults", () => {
    const preset = ciJobPreset({ command: ["node", "job.js"], env: { CI: "false", EXTRA: "1" }, timeoutMs: 1_000 });

    expect(preset.spec.env).toEqual({ CI: "false", EXTRA: "1" });
    expect(preset.spec.timeoutMs).toBe(1_000);
  });

  test("wraps nodeSandboxPreset for a local Docker agent", () => {
    const preset = dockerLocalAgentPreset({ timeoutMs: 5_000 });

    expect(preset.name).toBe("docker-local-agent");
    expect(preset.domain).toBe("sandbox");
    expect(preset.capabilityPaths).toEqual(["sandbox.create", "sandbox.exec", "sandbox.fileWrite", "sandbox.destroy"]);
    expect(preset.spec.labels).toEqual({ "capsule.io/preset": "docker-local-agent" });
    expect(preset.policy?.network).toEqual({ mode: "none" });
  });

  test("passes an explicit network through the docker local agent policy", () => {
    const preset = dockerLocalAgentPreset({ network: { mode: "allowlist", allowedHosts: ["registry.local"] } });

    expect(preset.policy?.network).toEqual({ mode: "allowlist", allowedHosts: ["registry.local"] });
    expect(() => dockerLocalAgentPreset({ network: { mode: "allowlist" } })).toThrow("network allowlist requires at least one allowed host");
  });

  test("adds a cost cap to the preview environment policy", () => {
    const preset = costLimitedPreviewPreset({ name: "pr-42", ttlMs: 60_000, maxUsd: 12 });

    expect(preset.name).toBe("cost-limited-preview");
    expect(preset.domain).toBe("preview");
    expect(preset.policy).toEqual({ ttl: { maxMs: 60_000 }, cost: { maxUsd: 12 } });
  });

  test("defaults the cost cap and rejects a non-positive cap", () => {
    expect(costLimitedPreviewPreset({ name: "pr-42" }).policy?.cost).toEqual({ maxUsd: 5 });
    expect(() => costLimitedPreviewPreset({ name: "pr-42", maxUsd: 0 })).toThrow("cost-limited-preview maxUsd must be greater than 0");
  });

  test("validates a preset against a policy and returns structured findings", () => {
    expect(validatePresetAgainstPolicy(undefined, {})).toEqual({ ok: true, findings: [] });

    const emptyAllowlist = validatePresetAgainstPolicy(undefined, { network: { mode: "allowlist" } });
    expect(emptyAllowlist.ok).toBe(false);
    expect(emptyAllowlist.findings[0]).toMatchObject({ code: "network.allowlist.empty", path: "network.allowedHosts" });

    const badCost = validatePresetAgainstPolicy(undefined, { cost: { maxUsd: -1 }, ttl: { maxMs: 0 }, limits: { timeoutMs: -5 } });
    expect(badCost.findings.map((finding) => finding.code)).toEqual(["cost.maxUsd.invalid", "ttl.maxMs.invalid", "limits.timeoutMs.invalid"]);

    const fromPreset = validatePresetAgainstPolicy(costLimitedPreviewPreset({ name: "pr-42", maxUsd: 3 }));
    expect(fromPreset.ok).toBe(true);
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
    expect(receipt.signature).toBeUndefined();
  });

  test("stamps the receipt schema version", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z")
    });
    expect(receipt.schemaVersion).toBe(CAPSULE_RECEIPT_SCHEMA_VERSION);
    expect(receipt.schemaVersion).toBe("capsule.receipt.v1");
  });

  test("threads a parent receipt id for chained receipts", () => {
    const receipt = createReceipt({
      type: "job.run",
      parentId: "receipt-parent-123",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z")
    });
    expect(receipt.parentId).toBe("receipt-parent-123");
  });

  test("surfaces the policy enforcement mode in the receipt policy section", () => {
    const decision = evaluatePolicy({}, { capabilityPath: "job.run", supportLevel: "native" });
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z"),
      policy: decision
    });
    expect(receipt.policy.enforcement).toBe("native");
    expect(receipt.policy.trace).toEqual([{ check: "support-level", verdict: "noted" }]);
  });

  test("records resource lineage metadata when supplied", () => {
    const receipt = createReceipt({
      type: "database.branch.create",
      provider: "test",
      adapter: "test",
      capabilityPath: "database.branchCreate",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z"),
      metadata: { sourceResourceId: "branch-main", parentResourceId: "project-app" }
    });
    expect(receipt.metadata).toMatchObject({ sourceResourceId: "branch-main", parentResourceId: "project-app" });
  });

  test("optionally signs receipts with a provided signer", () => {
    const receipt = createReceipt(
      {
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:00.500Z"),
        policy: { decision: "allowed", applied: {} },
        resource: { id: "job_123" }
      },
      {
        algorithm: "test-signature",
        keyId: "test-key",
        sign: (unsigned) => `${unsigned.type}:${unsigned.resource?.id}:${unsigned.durationMs}`
      }
    );

    expect(receipt.signature).toEqual({
      algorithm: "test-signature",
      keyId: "test-key",
      value: "job.run:job_123:500"
    });
  });

  test("signs and verifies canonical receipt payloads", () => {
    const receipt = createReceipt(
      {
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:00.500Z"),
        policy: { decision: "allowed", applied: {} },
        resource: { id: "job_123", status: "queued" },
        metadata: { zeta: "z", providerRequestId: "req_123", alpha: "a" }
      },
      {
        algorithm: "canonical-test",
        keyId: "test-key",
        sign: (_unsigned, payload) => `sig:${payload}`
      }
    );

    const payload = canonicalReceiptPayload(receipt);
    expect(payload).not.toContain('"signature"');
    expect(payload).toContain('"metadata":{"alpha":"a","providerRequestId":"req_123","zeta":"z"}');
    expect(receipt.signature).toEqual({
      algorithm: "canonical-test",
      keyId: "test-key",
      value: `sig:${payload}`
    });
    const verifier = {
      algorithm: "canonical-test",
      keyId: "test-key",
      verify: (payload: string, signature: string) => signature === `sig:${payload}`
    };
    expect(verifyReceiptSignature(receipt, verifier)).toEqual({ valid: true });

    const tampered = { ...receipt, resource: { ...receipt.resource, status: "succeeded" } };
    expect(verifyReceiptSignature(tampered, verifier)).toEqual({ valid: false, reason: "signature-mismatch" });
  });

  test("verifies receipt schema and optional signatures", () => {
    const receipt = createReceipt(
      {
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:00.500Z"),
        policy: { decision: "allowed", applied: {} },
        resource: { id: "job_123" }
      },
      {
        algorithm: "canonical-test",
        keyId: "test-key",
        sign: (_unsigned, payload) => `sig:${payload}`
      }
    );
    const verifier = {
      algorithm: "canonical-test",
      keyId: "test-key",
      verify: (payload: string, signature: string) => signature === `sig:${payload}`
    };

    expect(verifyReceipt(receipt, { verifier })).toMatchObject({
      valid: true,
      schema: { valid: true, errors: [] },
      signature: { status: "valid" },
      redaction: { status: "passed", findings: [] }
    });
    expect(verifyReceipt({ ...receipt, supportLevel: "imaginary" }, { verifier })).toMatchObject({
      valid: false,
      schema: { valid: false, errors: expect.arrayContaining(["supportLevel must be one of native, emulated, unsupported, experimental."]) }
    });
    expect(verifyReceipt({ ...receipt, resource: { ...receipt.resource, status: "tampered" } }, { verifier })).toMatchObject({
      valid: false,
      signature: { status: "invalid", reason: "signature-mismatch" }
    });
  });

  test("detects unredacted sensitive receipt fields", () => {
    const receipt = {
      ...createReceipt({
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z")
      }),
      metadata: { apiKey: "secret-token" }
    };

    expect(verifyReceipt(receipt)).toMatchObject({
      valid: false,
      redaction: {
        status: "failed",
        findings: ["metadata.apiKey contains an unredacted sensitive value."]
      }
    });
  });

  test("exports verifiable evidence bundles from receipts logs artifacts and provider metadata", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z"),
      stdout: "ok",
      stderr: "",
      policy: { decision: "allowed", applied: { network: { mode: "none" } }, notes: ["observed"] },
      resource: { id: "job_123", status: "succeeded" },
      metadata: { providerRequestId: "req_123", idempotencyKey: "idem_123" }
    });
    const logs = [{ timestamp: "2026-01-01T00:00:00.250Z", stream: "stdout" as const, message: "ok" }];
    const artifacts = [{ name: "stdout.txt", sha256: receipt.stdoutHash }];

    const bundle = createEvidenceBundle({
      receipts: [receipt],
      logs,
      artifacts,
      createdAt: new Date("2026-01-01T00:00:01.000Z")
    });

    expect(bundle).toMatchObject({
      schema: "capsule.evidence.bundle.v1",
      createdAt: "2026-01-01T00:00:01.000Z",
      receipts: [receipt],
      logs,
      artifacts,
      policyDecisions: [
        {
          receiptId: receipt.id,
          type: "job.run",
          capabilityPath: "job.run",
          decision: "allowed",
          applied: { network: { mode: "none" } },
          notes: ["observed"]
        }
      ],
      providerMetadata: [
        {
          receiptId: receipt.id,
          provider: "test",
          adapter: "test",
          capabilityPath: "job.run",
          supportLevel: "native",
          resource: { id: "job_123", status: "succeeded" },
          metadata: { providerRequestId: "req_123", idempotencyKey: "idem_123" }
        }
      ],
      digest: { algorithm: "sha256" }
    });
    expect(verifyEvidenceBundle(bundle)).toEqual({ valid: true });
    expect(verifyEvidenceBundle({ ...bundle, digest: { ...bundle.digest, algorithm: "sha1" } } as any)).toEqual({
      valid: false,
      reason: "digest-algorithm-mismatch"
    });
    expect(verifyEvidenceBundle({ ...bundle, logs: [{ ...logs[0], message: "tampered" }] })).toMatchObject({
      valid: false,
      reason: "digest-mismatch"
    });
  });

  test("records sanitized provider options on receipts", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z"),
      providerOptions: {
        region: "us-east-1",
        retryCount: 2,
        nested: {
          placement: "spot",
          apiToken: "secret-token"
        },
        env: [
          { name: "VISIBLE", value: "safe" },
          { name: "PRIVATE", secret: "secret-value" }
        ]
      }
    });

    expect(receipt.providerOptions).toEqual({
      region: "us-east-1",
      retryCount: 2,
      nested: {
        placement: "spot",
        apiToken: "[REDACTED]"
      },
      env: [
        { name: "VISIBLE", value: "safe" },
        { name: "PRIVATE", secret: "[REDACTED]" }
      ]
    });
    expect(JSON.stringify(receipt)).not.toContain("secret-token");
    expect(JSON.stringify(receipt)).not.toContain("secret-value");
  });

  test("redacts sensitive receipt metadata before signing or storing", () => {
    const receipt = createReceipt(
      {
        type: "job.run",
        provider: "test",
        adapter: "test",
        capabilityPath: "job.run",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:00.500Z"),
        policy: { decision: "allowed", applied: {} },
        metadata: {
          providerRequestId: "req_123",
          idempotencyKey: "idem_123",
          idempotencyScope: "job.run",
          authorization: "Bearer secret-token",
          Authorization: "Bearer uppercase-secret",
          xApiKey: "header-api-key",
          bearerToken: "bearer-secret",
          authToken: "auth-secret",
          nested: {
            apiKey: "provider-api-key",
            apiToken: "provider-api-token",
            safe: "visible"
          },
          attempts: [{ session_token: "session-secret", providerRequestId: "req_retry" }]
        }
      },
      {
        algorithm: "test-signature",
        sign: (unsigned) => JSON.stringify(unsigned.metadata)
      }
    );

    expect(receipt.metadata).toEqual({
      providerRequestId: "req_123",
      idempotencyKey: "idem_123",
      idempotencyScope: "job.run",
      authorization: "[REDACTED]",
      Authorization: "[REDACTED]",
      xApiKey: "[REDACTED]",
      bearerToken: "[REDACTED]",
      authToken: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        apiToken: "[REDACTED]",
        safe: "visible"
      },
      attempts: [{ session_token: "[REDACTED]", providerRequestId: "req_retry" }]
    });
    expect(receipt.signature?.value).not.toContain("secret-token");
    expect(receipt.signature?.value).not.toContain("uppercase-secret");
    expect(JSON.stringify(receipt)).not.toContain("header-api-key");
    expect(JSON.stringify(receipt)).not.toContain("bearer-secret");
    expect(JSON.stringify(receipt)).not.toContain("auth-secret");
    expect(JSON.stringify(receipt)).not.toContain("provider-api-key");
    expect(JSON.stringify(receipt)).not.toContain("provider-api-token");
    expect(JSON.stringify(receipt)).not.toContain("session-secret");
  });

  test("builds provider runtime receipt metadata without empty fields", () => {
    expect(
      providerRuntimeMetadata({
        providerApiVersion: "v2",
        providerRegion: "us-central1",
        adapterVersion: "0.1.1"
      })
    ).toEqual({
      providerApiVersion: "v2",
      providerRegion: "us-central1",
      runtimeVersion: process.version,
      adapterVersion: "0.1.1"
    });
    expect(providerRuntimeMetadata({ providerApiVersion: "", providerRegion: null, adapterVersion: undefined })).toEqual({
      runtimeVersion: process.version
    });
  });

  test("applies strict redaction profile to receipt provider metadata and options", () => {
    const receipt = createReceipt({
      type: "job.run",
      provider: "test",
      adapter: "test",
      capabilityPath: "job.run",
      supportLevel: "native",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: new Date("2026-01-01T00:00:00.500Z"),
      policy: { decision: "allowed", applied: { secrets: { redactionProfile: "strict", redactKeys: ["sessionId"] } } },
      providerOptions: {
        responseBody: "Bearer <SK_LIVE_REDACTED>",
        sessionId: "custom-secret-value"
      },
      metadata: {
        providerMessage: "ghp_1234567890abcdef1234567890abcdef1234",
        nested: { publicNote: "keep me" }
      }
    });

    expect(receipt.providerOptions).toEqual({
      responseBody: "Bearer [REDACTED]",
      sessionId: "[REDACTED]"
    });
    expect(receipt.metadata).toEqual({
      providerMessage: "[REDACTED]",
      nested: { publicNote: "keep me" }
    });
  });

  test("redacts configured secret values from adapter errors", async () => {
    const failingAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        job: {
          run: "native",
          status: "unsupported",
          cancel: "unsupported",
          logs: "unsupported",
          artifacts: "unsupported",
          timeout: "unsupported",
          env: "native"
        }
      },
      job: {
        run: async (spec) => {
          throw new AdapterExecutionError(`provider echoed ${spec.env?.SECRET}`);
        }
      }
    };
    const capsule = new Capsule({ adapter: failingAdapter, policy: { secrets: { allowed: ["SECRET"], redactFromLogs: true } } });

    await expect(capsule.job.run({ image: "node:22", env: { SECRET: "super-secret-token" } })).rejects.toThrow("provider echoed [REDACTED]");
    await expect(capsule.job.run({ image: "node:22", env: { SECRET: "super-secret-token" } })).rejects.not.toThrow("super-secret-token");
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

  test("rejects adapter receipts outside the active operation scope", async () => {
    const receiptStore = new MemoryReceiptStore();
    const dishonestAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "unsupported",
          update: "unsupported",
          delete: "native",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async () => ({ id: "svc_123", provider: "test", name: "svc", status: "ready" }),
        delete: async (_spec, context) => {
          context.createReceipt({ type: "job.run", capabilityPath: "job.run", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return { id: "svc_123", provider: "test", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({ adapter: dishonestAdapter, receipts: true, receiptStore });

    await expect(capsule.service.delete({ id: "svc_123" })).rejects.toThrow("outside active operation receipt scope");
    expect(receiptStore.receipts).toEqual([]);
  });

  test("records operation idempotency keys on adapter receipts", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "unsupported",
          update: "unsupported",
          delete: "native",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async () => ({ id: "svc_123", provider: "test", name: "svc", status: "ready" }),
        delete: async (_spec, context) => {
          context.createReceipt({
            type: "service.delete",
            capabilityPath: "service.delete",
            startedAt: new Date("2026-01-01T00:00:00.000Z")
          });
          return { id: "svc_123", provider: "test", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptStore });

    await capsule.service.delete({ id: "svc_123", idempotencyKey: "delete-svc-123" });

    expect(receiptStore.receipts[0]?.metadata).toMatchObject({
      idempotencyKey: "delete-svc-123",
      idempotencyScope: "service.delete",
      operationTag: capsuleOperationTag({ idempotencyKey: "delete-svc-123", capabilityPath: "service.delete" })
    });
  });

  test("derives deterministic non-secret operation tags for provider labels", () => {
    const first = capsuleOperationTag({ idempotencyKey: "user-facing-key-123", capabilityPath: "service.deploy" });
    const second = capsuleOperationTag({ idempotencyKey: "user-facing-key-123", capabilityPath: "service.deploy" });
    const differentScope = capsuleOperationTag({ idempotencyKey: "user-facing-key-123", capabilityPath: "job.run" });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toContain("user-facing-key-123");
    expect(differentScope).not.toBe(first);
    expect(capsuleOperationTags({ idempotencyKey: "user-facing-key-123", capabilityPath: "service.deploy" })).toEqual({
      capsule_operation_key: first,
      capsule_operation_scope: "service_deploy"
    });
  });

  test("operation idempotency keys override conflicting adapter receipt metadata", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        service: {
          deploy: "unsupported",
          update: "unsupported",
          delete: "native",
          status: "unsupported",
          logs: "unsupported",
          url: "unsupported"
        }
      },
      service: {
        deploy: async () => ({ id: "svc_123", provider: "test", name: "svc", status: "ready" }),
        delete: async (_spec, context) => {
          context.createReceipt({
            type: "service.delete",
            capabilityPath: "service.delete",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            metadata: { idempotencyKey: "adapter-key", idempotencyScope: "adapter-scope", providerRequestId: "req_123" }
          });
          return { id: "svc_123", provider: "test", status: "deleted" };
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptStore });

    await capsule.service.delete({ id: "svc_123", idempotencyKey: "caller-key" });

    expect(receiptStore.receipts[0]?.metadata).toMatchObject({
      idempotencyKey: "caller-key",
      idempotencyScope: "service.delete",
      providerRequestId: "req_123"
    });
  });

  test("allows only sandbox lifecycle receipts on sandbox contexts", async () => {
    const receiptStore = new MemoryReceiptStore();
    const sandboxAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return {
            handle: { id: "box", provider: "test", createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString() },
            exec: async () => {
              const receipt = context.createReceipt({ type: "sandbox.exec", capabilityPath: "sandbox.exec", startedAt: new Date("2026-01-01T00:00:01.000Z") });
              return { exitCode: 0, stdout: "ok", stderr: "", logs: [], artifacts: [], receipt };
            },
            writeFile: async () => undefined,
            readFile: async () => new Uint8Array(),
            listFiles: async () => [],
            destroy: async () => {
              context.createReceipt({ type: "sandbox.destroy", capabilityPath: "sandbox.destroy", startedAt: new Date("2026-01-01T00:00:02.000Z") });
            }
          };
        }
      }
    };
    const capsule = new Capsule({ adapter: sandboxAdapter, receipts: true, receiptStore });

    const box = await capsule.sandbox.create({});
    await box.exec({ command: ["node", "-e", "console.log(1)"] });
    await box.destroy();

    expect(receiptStore.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.exec", "sandbox.destroy"]);
  });

  test("checks sandbox sub-operation capabilities before calling adapter methods", async () => {
    let writeCalled = false;
    const limitedAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        sandbox: {
          ...capabilities.sandbox!,
          fileWrite: "unsupported"
        }
      },
      sandbox: {
        create: async () => ({
          handle: { id: "box", provider: "test", createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString() },
          exec: async () => ({ exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] }),
          writeFile: async () => {
            writeCalled = true;
          },
          readFile: async () => new Uint8Array(),
          listFiles: async () => [],
          destroy: async () => undefined
        })
      }
    };
    const capsule = new Capsule({ adapter: limitedAdapter });

    const box = await capsule.sandbox.create({});
    await expect(box.writeFile("/workspace/secret.txt", "secret")).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    expect(writeCalled).toBe(false);
  });

  test("evaluates sandbox exec policy before calling the adapter method", async () => {
    let execCalled = false;
    const policyAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async () => ({
          handle: { id: "box", provider: "test", createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString() },
          exec: async () => {
            execCalled = true;
            return { exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] };
          },
          writeFile: async () => undefined,
          readFile: async () => new Uint8Array(),
          listFiles: async () => [],
          destroy: async () => undefined
        })
      }
    };
    const capsule = new Capsule({ adapter: policyAdapter, policy: { secrets: { allowed: ["SAFE"] } } });

    const box = await capsule.sandbox.create({});
    await expect(box.exec({ command: ["node", "index.js"], env: { TOKEN: "denied" } })).rejects.toBeInstanceOf(PolicyViolationError);
    expect(execCalled).toBe(false);
  });

  test("records core receipts for sandbox file sub-operations", async () => {
    const receiptStore = new MemoryReceiptStore();
    const fileAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return {
            handle: { id: "box", provider: "test", createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString() },
            exec: async () => ({ exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] }),
            writeFile: async () => undefined,
            readFile: async () => new TextEncoder().encode("hello"),
            listFiles: async () => [{ name: "hello.txt", path: "/workspace/hello.txt", type: "file", sizeBytes: 5 }],
            destroy: async () => undefined
          };
        }
      }
    };
    const capsule = new Capsule({ adapter: fileAdapter, receipts: true, receiptStore });

    const box = await capsule.sandbox.create({});
    await box.writeFile("/workspace/hello.txt", "hello");
    await box.readFile("/workspace/hello.txt");
    await box.listFiles("/workspace");

    expect(receiptStore.receipts.map((receipt) => receipt.type)).toEqual(["sandbox.create", "sandbox.file.write", "sandbox.file.read", "sandbox.file.list"]);
    expect(receiptStore.receipts.slice(1).map((receipt) => receipt.capabilityPath)).toEqual(["sandbox.fileWrite", "sandbox.fileRead", "sandbox.fileList"]);
    expect(receiptStore.receipts[1]?.metadata).toMatchObject({ path: "/workspace/hello.txt", byteLength: 5 });
    expect(receiptStore.receipts[2]?.metadata).toMatchObject({ path: "/workspace/hello.txt", byteLength: 5 });
    expect(receiptStore.receipts[3]?.metadata).toMatchObject({ path: "/workspace", entryCount: 1 });
  });

  test("records one receipt per concurrent sandbox sub-operation", async () => {
    const receiptStore = new MemoryReceiptStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return {
            handle: { id: "box", provider: "test", createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString() },
            exec: async () => ({ exitCode: 0, stdout: "", stderr: "", logs: [], artifacts: [] }),
            writeFile: async (path: string) => {
              if (path.endsWith("slow.txt")) {
                await gate;
              }
            },
            readFile: async () => new Uint8Array(),
            listFiles: async () => [],
            destroy: async () => undefined
          };
        }
      }
    };
    const capsule = new Capsule({ adapter: slowAdapter, receipts: true, receiptStore });

    const box = await capsule.sandbox.create({});
    const slow = box.writeFile("/workspace/slow.txt", "slow");
    await box.writeFile("/workspace/fast.txt", "fast");
    release();
    await slow;

    const writes = receiptStore.receipts.filter((receipt) => receipt.type === "sandbox.file.write");
    expect(writes).toHaveLength(2);
    expect(writes.map((receipt) => receipt.metadata?.path).sort()).toEqual(["/workspace/fast.txt", "/workspace/slow.txt"]);
  });

  test("continues when best-effort receipt persistence fails", async () => {
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptPersistence: "best-effort",
      receiptStore: {
        write: async () => {
          throw new Error("disk full");
        }
      }
    });

    await expect(capsule.sandbox.create({})).resolves.toMatchObject({
      handle: { id: "box", provider: "test" }
    });
  });

  test("fails closed when required receipt persistence fails", async () => {
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        write: async () => {
          throw new Error("disk full");
        }
      }
    });

    await expect(capsule.sandbox.create({})).rejects.toThrow("disk full");
  });

  test("required receipt persistence rejects when no store is configured", async () => {
    let called = false;
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          called = true;
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptPersistence: "required" });

    await expect(capsule.sandbox.create({})).rejects.toThrow("Receipt persistence is required but no receiptStore is configured");
    expect(called).toBe(false);
  });

  test("required receipt persistence preflights store readiness before adapter calls", async () => {
    let called = false;
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      sandbox: {
        create: async (_spec, context) => {
          called = true;
          context.createReceipt({ type: "sandbox.create", capabilityPath: "sandbox.create", startedAt: new Date("2026-01-01T00:00:00.000Z") });
          return adapter.sandbox!.create({}, context);
        }
      }
    };
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptPersistence: "required",
      receiptStore: {
        ready: async () => {
          throw new Error("receipt store unavailable");
        },
        write: async () => undefined
      }
    });

    await expect(capsule.sandbox.create({})).rejects.toThrow("receipt store unavailable");
    expect(called).toBe(false);
  });

  test("lets adapters propagate typed provider options into receipts without leaking secrets", async () => {
    const receiptStore = new MemoryReceiptStore();
    const receiptAdapter: CapsuleAdapter = {
      ...adapter,
      capabilities: {
        ...capabilities,
        job: {
          ...capabilities.job!,
          run: "native"
        }
      },
      job: {
        run: async (spec, context) => {
          const receipt = context.createReceipt({
            type: "job.run",
            capabilityPath: "job.run",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            finishedAt: new Date("2026-01-01T00:00:00.500Z"),
            image: spec.image,
            providerOptions: spec.providerOptions
          });
          return { id: "job_123", provider: "test", status: "queued", receipt };
        }
      }
    };
    const capsule = new Capsule({ adapter: receiptAdapter, receipts: true, receiptStore });
    await capsule.job.run({
      image: "node:22",
      providerOptions: {
        region: "iad",
        concurrency: 1,
        bearerToken: "do-not-store"
      }
    });

    expect(receiptStore.receipts[0]?.providerOptions).toEqual({
      region: "iad",
      concurrency: 1,
      bearerToken: "[REDACTED]"
    });
    expect(JSON.stringify(receiptStore.receipts[0])).not.toContain("do-not-store");
  });

  test("signs receipts created through Capsule context", async () => {
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
    const capsule = new Capsule({
      adapter: receiptAdapter,
      receipts: true,
      receiptStore,
      receiptSigner: {
        algorithm: "test-signature",
        sign: (unsigned) => `signed:${unsigned.type}:${unsigned.provider}`
      }
    });
    await capsule.sandbox.create({});
    expect(receiptStore.receipts[0]?.signature).toMatchObject({
      algorithm: "test-signature",
      value: "signed:sandbox.create:test"
    });
  });

  test("exports a JSON Schema artifact for receipts", () => {
    const artifact = JSON.parse(readFileSync(new URL("../../../schemas/capsule-receipt.schema.json", import.meta.url), "utf8"));
    expect(artifact).toEqual(capsuleReceiptJsonSchema);
    const receipt = createReceipt(
      {
        type: "sandbox.exec",
        provider: "test",
        adapter: "test",
        capabilityPath: "sandbox.exec",
        supportLevel: "native",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        finishedAt: new Date("2026-01-01T00:00:01.000Z"),
        command: ["node", "index.js"],
        image: "node:22",
        stdout: "ok",
        stderr: "",
        providerOptions: { region: "test" },
        policy: { decision: "allowed", applied: { network: { mode: "none" } }, notes: ["observed"] },
        resource: { id: "box", status: "ready" },
        metadata: { example: true, providerRequestId: "req_123", idempotencyKey: "idem_123", idempotencyScope: "sandbox.exec" }
      },
      { algorithm: "test-signature", sign: (unsigned) => `signed:${unsigned.id}` }
    );
    expect(capsuleReceiptJsonSchema.properties.metadata.properties).toMatchObject({
      providerRequestId: { type: "string" },
      providerApiVersion: { type: "string" },
      providerRegion: { type: "string" },
      runtimeVersion: { type: "string" },
      adapterVersion: { type: "string" },
      idempotencyKey: { type: "string" },
      idempotencyScope: { type: "string" },
      operationTag: { type: "string" },
      sourceResourceId: { type: "string" },
      parentResourceId: { type: "string" }
    });
    expect(capsuleReceiptJsonSchema.properties.schemaVersion).toEqual({ type: "string", const: "capsule.receipt.v1" });
    expect(capsuleReceiptJsonSchema.properties.parentId).toEqual({ type: "string" });
    expect(capsuleReceiptJsonSchema.properties.policy.properties.enforcement).toEqual({
      type: "string",
      enum: ["native", "delegated", "advisory", "unsupported"]
    });
    expect(validateAgainstSimpleSchema(capsuleReceiptJsonSchema, JSON.parse(JSON.stringify(receipt)))).toEqual([]);
  });
});
